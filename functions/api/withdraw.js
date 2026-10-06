const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const FEE_RATE = 0.01;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const textEncoder = new TextEncoder();

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

function toBase64Url(bytes) {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
  return toBase64Url(new Uint8Array(signature));
}

function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function signToken(env, userId) {
  const payload = `${userId}.${Date.now() + TOKEN_TTL_MS}`;
  const signature = await hmac(env.ADMIN_SECRET, payload);
  return `${payload}.${signature}`;
}

async function verifyToken(env, token) {
  if (!token || !env.ADMIN_SECRET) return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const [userId, expiry, signature] = parts;
  if (!Number(expiry) || Number(expiry) < Date.now()) return null;
  const expected = await hmac(env.ADMIN_SECRET, `${userId}.${expiry}`);
  if (!safeEqual(signature, expected)) return null;
  return userId;
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

async function handleRequestWithdraw(env, body) {
  const { uuid, pin, bank_code, bank_name, account_number } = body;
  if (!isSafeId(uuid)) return reply({ success: false, message: "Bad Parameters" }, 400);

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
    return reply({ success: false, message: "Incorrect transaction PIN" });
  }

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

async function handleAdminLogin(env, request, body) {
  if (!env.ADMIN_SECRET || !env.ADMIN_EMAILS) {
    return reply({ success: false, message: "Admin access is not configured" });
  }

  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  if (!email || !password) {
    return reply({ success: false, message: "Enter your email and password" });
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const attemptsKey = `admin-attempts:${ip}`;
  if (env.LOCK_KV) {
    const attempts = parseInt((await env.LOCK_KV.get(attemptsKey)) || "0", 10);
    if (attempts >= 8) {
      return reply({ success: false, message: "Too many attempts. Try again in 10 minutes" }, 429);
    }
  }

  const admins = String(env.ADMIN_EMAILS)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  let matched = null;

  if (admins.includes(email.toLowerCase())) {
    const candidates = Array.from(new Set([email, email.toLowerCase()]));
    for (const candidate of candidates) {
      const res = await db(
        env,
        `user_profiles?user_data->>email=eq.${encodeURIComponent(candidate)}&select=id,user_data&limit=5`
      );
      if (res.ok && Array.isArray(res.data)) {
        const found = res.data.find((row) => row.user_data && safeEqual(String(row.user_data.password || ""), password));
        if (found) {
          matched = found;
          break;
        }
      }
    }
  }

  if (!matched) {
    if (env.LOCK_KV) {
      const attempts = parseInt((await env.LOCK_KV.get(attemptsKey)) || "0", 10);
      await env.LOCK_KV.put(attemptsKey, String(attempts + 1), { expirationTtl: 600 });
    }
    return reply({ success: false, message: "Invalid email or password" }, 401);
  }

  if (env.LOCK_KV) await env.LOCK_KV.delete(attemptsKey);

  const token = await signToken(env, matched.id);
  return reply({ success: true, token, name: matched.user_data.full_name || "Admin" });
}

async function loadWalletStats(env) {
  const size = 1000;
  let offset = 0;
  let totalUsers = 0;
  let totalWallet = 0;
  let usersWithFunds = 0;

  for (;;) {
    const res = await db(
      env,
      `user_profiles?select=id,balance:user_data->>user_balance&order=id.asc&limit=${size}&offset=${offset}`
    );
    if (!res.ok || !Array.isArray(res.data)) throw new Error("Unable to read users");
    res.data.forEach((row) => {
      const value = parseFloat(row.balance || 0) || 0;
      totalUsers += 1;
      totalWallet += value;
      if (value > 0) usersWithFunds += 1;
    });
    if (res.data.length < size) break;
    offset += size;
  }

  return { total_users: totalUsers, total_wallet: round2(totalWallet), users_with_funds: usersWithFunds };
}

async function loadBalances(env, ids) {
  const map = {};
  const clean = Array.from(new Set(ids.filter(isSafeId)));
  for (let i = 0; i < clean.length; i += 40) {
    const chunk = clean.slice(i, i + 40);
    const res = await db(env, `user_profiles?id=in.(${chunk.join(",")})&select=id,balance:user_data->>user_balance`);
    if (res.ok && Array.isArray(res.data)) {
      res.data.forEach((row) => {
        map[row.id] = parseFloat(row.balance || 0) || 0;
      });
    }
  }
  return map;
}

async function handleAdminDashboard(env) {
  const stats = await loadWalletStats(env);
  const pendingRes = await db(env, "withdrawals?status=eq.pending&order=created_at.asc&limit=500");
  if (!pendingRes.ok || !Array.isArray(pendingRes.data)) {
    return reply({ success: false, message: "Unable to load pending withdrawals" });
  }
  const balances = await loadBalances(env, pendingRes.data.map((item) => item.user_id));
  const now = Date.now();
  const pending = pendingRes.data.map((item) => ({
    ...item,
    current_balance: balances[item.user_id] !== undefined ? balances[item.user_id] : 0,
    overdue: now - new Date(item.created_at).getTime() > 24 * 60 * 60 * 1000
  }));
  return reply({ success: true, stats, pending });
}

async function deductBalance(env, userId, amount) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const profile = await getProfile(env, userId);
    if (!profile) return { ok: false, message: "User profile not found" };

    const userData = profile.user_data || {};
    const oldValue = String(userData.user_balance !== undefined && userData.user_balance !== null ? userData.user_balance : "0.00");
    const balance = parseFloat(oldValue) || 0;
    if (balance < amount) {
      return { ok: false, message: "User wallet balance is lower than the withdrawal amount" };
    }

    const newBalance = round2(balance - amount).toFixed(2);
    const update = await db(
      env,
      `user_profiles?id=eq.${encodeURIComponent(userId)}&user_data->>user_balance=eq.${encodeURIComponent(oldValue)}`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: { user_data: { ...userData, user_balance: newBalance } }
      }
    );
    if (update.ok && Array.isArray(update.data) && update.data.length > 0) {
      return { ok: true, balance: newBalance };
    }
  }
  return { ok: false, message: "Wallet changed during processing. Please try again" };
}

async function handleAdminComplete(env, body, adminId) {
  const id = body.id;
  if (!isSafeId(id)) return reply({ success: false, message: "Bad Parameters" }, 400);

  const claim = await db(env, `withdrawals?id=eq.${encodeURIComponent(id)}&status=eq.pending`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { status: "processing" }
  });
  if (!claim.ok || !Array.isArray(claim.data) || claim.data.length === 0) {
    return reply({ success: false, message: "This request is no longer pending" });
  }

  const withdrawal = claim.data[0];
  const deduction = await deductBalance(env, withdrawal.user_id, Number(withdrawal.amount));

  if (!deduction.ok) {
    await db(env, `withdrawals?id=eq.${encodeURIComponent(id)}&status=eq.processing`, {
      method: "PATCH",
      body: { status: "pending" }
    });
    return reply({ success: false, message: deduction.message });
  }

  let finalRow = null;
  for (let attempt = 0; attempt < 3 && !finalRow; attempt++) {
    const done = await db(env, `withdrawals?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by: adminId,
        balance_after: deduction.balance
      }
    });
    if (done.ok && Array.isArray(done.data) && done.data.length > 0) finalRow = done.data[0];
  }

  if (!finalRow) {
    return reply({
      success: false,
      message: `Wallet was debited but the status could not be saved. Reference: ${withdrawal.reference}`
    });
  }

  return reply({ success: true, message: "Payment completed", withdrawal: finalRow, new_balance: deduction.balance });
}

async function handleAdminDelete(env, body) {
  const id = body.id;
  if (!isSafeId(id)) return reply({ success: false, message: "Bad Parameters" }, 400);

  const res = await db(env, `withdrawals?id=eq.${encodeURIComponent(id)}&status=eq.pending`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { status: "cancelled" }
  });
  if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
    return reply({ success: false, message: "This request is no longer pending" });
  }
  return reply({ success: true, message: "Withdrawal request deleted" });
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
      case "admin_login":
        return await handleAdminLogin(env, request, body);
      case "admin_dashboard":
      case "admin_complete":
      case "admin_delete": {
        const adminId = await verifyToken(env, body.token);
        if (!adminId) return reply({ success: false, message: "Session expired. Please login again" }, 401);
        if (body.action === "admin_dashboard") return await handleAdminDashboard(env);
        if (body.action === "admin_complete") return await handleAdminComplete(env, body, adminId);
        return await handleAdminDelete(env, body);
      }
      default:
        return reply({ success: false, message: "Unknown action" }, 400);
    }
  } catch {
    return reply({ success: false, message: "Internal server error" }, 500);
  }
}

export async function onRequest(context) {
  return handle(context.request, context.env);
}

export default {
  async fetch(request, env) {
    return handle(request, env);
  }
};