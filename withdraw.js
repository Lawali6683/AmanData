const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const FEE_RATE = 0.01;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_SECONDS = 600;

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function isSafeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function restBase(env) {
  let url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!/\/rest\/v1$/.test(url)) url += "/rest/v1";
  return url + "/";
}

async function db(env, path, options = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;
  const res = await fetch(restBase(env) + path, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

async function monnifyToken(env) {
  const secret = btoa(`${env.MONNIFY_API_KEY}:${env.MONNIFY_SECRET_KEY}`);
  const res = await fetch(`${env.MONNIFY_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${secret}` }
  });
  const data = await res.json();
  return data && data.responseBody ? data.responseBody.accessToken : null;
}

async function resolveAccount(env, bankCode, accountNumber) {
  try {
    const token = await monnifyToken(env);
    if (!token) return null;
    const url = `${env.MONNIFY_BASE_URL}/api/v1/disbursements/account/validate?accountNumber=${encodeURIComponent(accountNumber)}&bankCode=${encodeURIComponent(bankCode)}`;
    const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data && data.requestSuccessful && data.responseBody && data.responseBody.accountName) {
      return data.responseBody.accountName;
    }
    return null;
  } catch {
    return null;
  }
}

async function getProfile(env, uuid) {
  const res = await db(env, `user_profiles?id=eq.${encodeURIComponent(uuid)}&select=id,user_data&limit=1`);
  if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) return null;
  return res.data[0];
}

async function findOpenWithdrawal(env, uuid) {
  const res = await db(
    env,
    `withdrawals?user_id=eq.${encodeURIComponent(uuid)}&status=in.(pending,processing)&order=created_at.desc&limit=1`
  );
  if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) return null;
  return res.data[0];
}

async function handleVerifyAccount(env, body) {
  const accountNumber = String(body.account_number || "");
  const bankCode = String(body.bank_code || "");
  if (!/^\d{10}$/.test(accountNumber) || !bankCode) {
    return reply({ success: false, message: "Invalid Account Details" });
  }
  const name = await resolveAccount(env, bankCode, accountNumber);
  if (!name) return reply({ success: false, message: "Invalid Account Details" });
  return reply({ success: true, account_name: name });
}

async function handleOverview(env, body) {
  const uuid = body.uuid;
  if (!isSafeId(uuid)) return reply({ success: false, message: "Bad Parameters" }, 400);
  const res = await db(env, `withdrawals?user_id=eq.${encodeURIComponent(uuid)}&order=created_at.desc&limit=100`);
  if (!res.ok || !Array.isArray(res.data)) {
    return reply({ success: false, message: "Unable to load withdrawal history" });
  }
  const pending = res.data.find((item) => item.status === "pending" || item.status === "processing") || null;
  return reply({ success: true, pending, history: res.data });
}

async function readAttempts(env, key) {
  if (!env.LOCK_KV) return 0;
  return parseInt((await env.LOCK_KV.get(key)) || "0", 10) || 0;
}

async function handleRequestWithdraw(env, body) {
  const { uuid, pin, bank_code, bank_name, account_number } = body;
  if (!isSafeId(uuid)) return reply({ success: false, message: "Bad Parameters" }, 400);

  const attemptsKey = `pin-attempts:${uuid}`;
  if ((await readAttempts(env, attemptsKey)) >= MAX_PIN_ATTEMPTS) {
    return reply({ success: false, message: "Too many wrong PIN attempts. Try again in 10 minutes" }, 429);
  }

  const amount = round2(parseFloat(body.amount));
  if (!isFinite(amount) || amount <= 0) {
    return reply({ success: false, message: "Enter a valid amount" });
  }
  if (!/^\d{10}$/.test(String(account_number || ""))) {
    return reply({ success: false, message: "Enter a valid 10 digit account number" });
  }
  if (!bank_code || !bank_name) {
    return reply({ success: false, message: "Select a destination bank" });
  }

  const profile = await getProfile(env, uuid);
  if (!profile) return reply({ success: false, message: "User profile not found" });

  const userData = profile.user_data || {};
  if (String(userData.pin || "") === "" || String(userData.pin) !== String(pin || "")) {
    if (env.LOCK_KV) {
      const attempts = await readAttempts(env, attemptsKey);
      await env.LOCK_KV.put(attemptsKey, String(attempts + 1), { expirationTtl: PIN_LOCK_SECONDS });
    }
    return reply({ success: false, message: "Incorrect transaction PIN" });
  }
  if (env.LOCK_KV) await env.LOCK_KV.delete(attemptsKey);

  const balance = parseFloat(userData.user_balance || 0) || 0;
  if (balance <= 0) {
    return reply({ success: false, message: "You do not have any funds in your wallet" });
  }
  if (balance < amount) {
    return reply({ success: false, message: "Insufficient wallet balance" });
  }

  const open = await findOpenWithdrawal(env, uuid);
  if (open) {
    return reply({ success: false, message: "You already have a pending withdrawal", pending: open });
  }

  const accountName = await resolveAccount(env, String(bank_code), String(account_number));
  if (!accountName) {
    return reply({ success: false, message: "Unable to verify account details" });
  }

  const fee = round2(amount * FEE_RATE);
  const net = round2(amount - fee);
  const reference = `WD-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;

  const insert = await db(env, "withdrawals", {
    method: "POST",
    prefer: "return=representation",
    body: {
      reference,
      user_id: uuid,
      full_name: String(userData.full_name || "").slice(0, 120),
      email: String(userData.email || "").slice(0, 160),
      amount,
      fee,
      net_amount: net,
      bank_name: String(bank_name).slice(0, 80),
      bank_code: String(bank_code).slice(0, 12),
      account_number: String(account_number),
      account_name: String(accountName).slice(0, 160),
      status: "pending"
    }
  });

  if (insert.status === 409) {
    return reply({ success: false, message: "You already have a pending withdrawal" });
  }
  if (!insert.ok || !Array.isArray(insert.data) || insert.data.length === 0) {
    return reply({ success: false, message: "Unable to save withdrawal request" });
  }

  return reply({ success: true, message: "Withdrawal request submitted", withdrawal: insert.data[0] });
}

async function handle(request, env) {
  if (request.method !== "POST") {
    return reply({ success: false, message: "Method Not Allowed" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return reply({ success: false, message: "Bad Request" }, 400);
  }

  const requiredPass = env.REQ_PASS || "@haruna66";
  if (!body || body.req_pass !== requiredPass) {
    return reply({ success: false, message: "Unauthorized Access" }, 401);
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return reply({ success: false, message: "Server is not configured" }, 500);
  }

  try {
    switch (body.action) {
      case "verify_account":
        return await handleVerifyAccount(env, body);
      case "overview":
        return await handleOverview(env, body);
      case "request_withdraw":
        return await handleRequestWithdraw(env, body);
      default:
        return reply({ success: false, message: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error(err);
    return reply({ success: false, message: "Internal server error" }, 500);
  }
}

export async function onRequest(context) {
  return handle(context.request, context.env);
}
