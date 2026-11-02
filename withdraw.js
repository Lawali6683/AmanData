const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const FEE_RATE = 0.01;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_SECONDS = 600;
const DB_TIMEOUT = 12000;
const MONNIFY_TIMEOUT = 10000;
const TOKEN_FALLBACK_SECONDS = 600;

const tokenCache = { value: null, expires: 0 };

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function toAmount(value) {
  const number = parseFloat(String(value === undefined || value === null ? 0 : value).replace(/,/g, ""));
  return isFinite(number) ? number : 0;
}

function isSafeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function restBase(env) {
  let url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!/\/rest\/v1$/.test(url)) url += "/rest/v1";
  return url + "/";
}

function monnifyBase(env) {
  return String(env.MONNIFY_BASE_URL || "").trim().replace(/\/+$/, "");
}

async function db(env, path, options = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;
  try {
    const res = await fetch(restBase(env) + path, {
      method: options.method || "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(DB_TIMEOUT)
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
  } catch (err) {
    console.error("db error", path.split("?")[0], err && err.message);
    return { ok: false, status: 0, data: null };
  }
}

async function monnifyToken(env) {
  if (tokenCache.value && Date.now() < tokenCache.expires) return tokenCache.value;
  const base = monnifyBase(env);
  if (!base || !env.MONNIFY_API_KEY || !env.MONNIFY_SECRET_KEY) return null;
  const secret = btoa(`${env.MONNIFY_API_KEY}:${env.MONNIFY_SECRET_KEY}`);
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${secret}` },
    signal: AbortSignal.timeout(MONNIFY_TIMEOUT)
  });
  const data = await res.json();
  const body = data && data.responseBody ? data.responseBody : null;
  if (!body || !body.accessToken) return null;
  const lifetime = Number(body.expiresIn) > 120 ? Number(body.expiresIn) - 60 : TOKEN_FALLBACK_SECONDS;
  tokenCache.value = body.accessToken;
  tokenCache.expires = Date.now() + lifetime * 1000;
  return tokenCache.value;
}

async function resolveAccount(env, bankCode, accountNumber) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const token = await monnifyToken(env);
      if (!token) return { error: "unavailable" };
      const url = `${monnifyBase(env)}/api/v1/disbursements/account/validate?accountNumber=${encodeURIComponent(accountNumber)}&bankCode=${encodeURIComponent(bankCode)}`;
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(MONNIFY_TIMEOUT)
      });
      if (res.status === 401) {
        tokenCache.value = null;
        continue;
      }
      const data = await res.json();
      if (data && data.requestSuccessful && data.responseBody && data.responseBody.accountName) {
        return { name: String(data.responseBody.accountName) };
      }
      return { error: "invalid" };
    } catch (err) {
      console.error("monnify error", err && err.message);
      return { error: "unavailable" };
    }
  }
  return { error: "unavailable" };
}

async function getProfile(env, uuid) {
  const res = await db(env, `user_profiles?id=eq.${encodeURIComponent(uuid)}&select=id,user_data&limit=1`);
  if (!res.ok) return { busy: true };
  if (!Array.isArray(res.data) || res.data.length === 0) return { profile: null };
  return { profile: res.data[0] };
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
  const result = await resolveAccount(env, bankCode, accountNumber);
  if (result.name) return reply({ success: true, account_name: result.name });
  if (result.error === "unavailable") {
    return reply({ success: false, message: "Account verification is not available right now. Please try again." });
  }
  return reply({ success: false, message: "Invalid Account Details" });
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

  const amount = round2(toAmount(body.amount));
  if (!(amount > 0)) {
    return reply({ success: false, message: "Enter a valid amount" });
  }
  if (!/^\d{10}$/.test(String(account_number || ""))) {
    return reply({ success: false, message: "Enter a valid 10 digit account number" });
  }
  if (!bank_code || !bank_name) {
    return reply({ success: false, message: "Select a destination bank" });
  }

  const found = await getProfile(env, uuid);
  if (found.busy) return reply({ success: false, message: "Service is busy right now. Please try again." });
  const profile = found.profile;
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

  const balance = round2(toAmount(userData.user_balance));
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

  const resolved = await resolveAccount(env, String(bank_code), String(account_number));
  if (!resolved.name) {
    return reply({
      success: false,
      message: resolved.error === "unavailable"
        ? "Unable to verify account details right now. Please try again."
        : "Unable to verify account details"
    });
  }

  const fee = round2(amount * FEE_RATE);
  const net = round2(amount - fee);
  if (!(net > 0)) {
    return reply({ success: false, message: "Enter a valid amount" });
  }
  const reference = `WD-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

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
      account_name: resolved.name.slice(0, 160),
      status: "pending"
    }
  });

  if (insert.status === 409 || (insert.data && insert.data.code === "23505")) {
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
