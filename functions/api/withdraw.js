const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const FEE_RATE = 0.01;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_SECONDS = 600;
const DB_TIMEOUT = 12000;
const PAYSTACK_BASE = "https://api.paystack.co";
const PAYSTACK_TIMEOUT = 10000;
const MAX_BANK_PAGES = 10;
const BANKS_TTL_MS = 6 * 60 * 60 * 1000;
const textEncoder = new TextEncoder();

const banksCache = { list: null, expires: 0, loading: null };

const MSG = {
  invalid: "Invalid Account Details",
  bank: "This bank is not supported for withdrawal. Please choose another bank.",
  unavailable: "Account verification is not available right now. Please try again."
};

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

function rpc(env, name, args) {
  return db(env, `rpc/${name}`, { method: "POST", body: args, prefer: "return=representation" });
}

function rpcMessage(res) {
  return res.data && res.data.message ? String(res.data.message) : "";
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

function paystackKey(env) {
  return String(env.PAYSTACK_API_KEY || env.PAYSTACK_SECRET_KEY || "").trim();
}

async function paystackGet(env, path) {
  const key = paystackKey(env);
  if (!key) return { status: 0, data: null, missing: true };
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(PAYSTACK_TIMEOUT)
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function loadBanks(env) {
  if (banksCache.list && Date.now() < banksCache.expires) return Promise.resolve(banksCache.list);
  if (!banksCache.loading) {
    banksCache.loading = fetchBanks(env).finally(() => {
      banksCache.loading = null;
    });
  }
  return banksCache.loading;
}

async function fetchBanks(env) {
  try {
    const found = new Map();
    let cursor = "";
    let complete = false;
    for (let page = 0; page < MAX_BANK_PAGES; page++) {
      const next = cursor ? `&next=${encodeURIComponent(cursor)}` : "";
      const res = await paystackGet(env, `/bank?country=nigeria&use_cursor=true&perPage=100${next}`);
      const items = res.data && res.data.data;
      if (res.status !== 200 || !res.data.status || !Array.isArray(items)) break;
      items.forEach((item) => {
        if (!item || !item.code || !item.name) return;
        if (item.active === false || item.is_deleted === true) return;
        if (item.currency && item.currency !== "NGN") return;
        const code = String(item.code);
        if (!found.has(code)) found.set(code, { code, name: String(item.name) });
      });
      cursor = res.data.meta && res.data.meta.next ? String(res.data.meta.next) : "";
      if (!cursor) {
        complete = true;
        break;
      }
    }
    if (complete && found.size > 0) {
      banksCache.list = Array.from(found.values());
      banksCache.expires = Date.now() + BANKS_TTL_MS;
      return banksCache.list;
    }
  } catch (err) {
    console.error("paystack banks error", err && err.message);
  }
  return banksCache.list;
}

async function resolveAccount(env, bankCode, accountNumber) {
  try {
    const banks = await loadBanks(env);
    if (banks && !banks.some((item) => item.code === bankCode)) return { error: "bank" };

    const path = `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`;
    const res = await paystackGet(env, path);
    if (res.missing) {
      console.error("paystack key is not set");
      return { error: "unavailable" };
    }

    const body = res.data && res.data.data;
    if (res.status === 200 && res.data.status === true && body && body.account_name) {
      return { name: String(body.account_name) };
    }
    if (res.status === 401 || res.status === 403) {
      console.error("paystack rejected the request", res.status, String((res.data && res.data.message) || "").slice(0, 160));
      return { error: "unavailable" };
    }
    if (!res.data || res.status === 0 || res.status === 429 || res.status >= 500) {
      return { error: "unavailable" };
    }
    if (/bank code/i.test(String(res.data.message || ""))) return { error: "bank" };
    return { error: "invalid" };
  } catch (err) {
    console.error("paystack error", err && err.message);
    return { error: "unavailable" };
  }
}

function accountFailure(result) {
  if (result.error === "bank") return reply({ success: false, message: MSG.bank });
  if (result.error === "unavailable") return reply({ success: false, message: MSG.unavailable, retry: true });
  return reply({ success: false, message: MSG.invalid });
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

async function handleBanks(env) {
  const banks = await loadBanks(env);
  if (!banks) return reply({ success: false, message: "The bank list is not available right now" });
  const sorted = banks.slice().sort((a, b) => a.name.localeCompare(b.name));
  return reply({ success: true, banks: sorted });
}

async function handleVerifyAccount(env, body) {
  const accountNumber = String(body.account_number || "");
  const bankCode = String(body.bank_code || "");
  if (!/^\d{10}$/.test(accountNumber) || !bankCode) {
    return reply({ success: false, message: MSG.invalid });
  }
  const result = await resolveAccount(env, bankCode, accountNumber);
  if (result.name) return reply({ success: true, account_name: result.name });
  return accountFailure(result);
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

async function authorizePin(env, uuid, pin) {
  const attemptsKey = `pin-attempts:${uuid}`;
  if ((await readAttempts(env, attemptsKey)) >= MAX_PIN_ATTEMPTS) {
    return { response: reply({ success: false, message: "Too many wrong PIN attempts. Try again in 10 minutes" }, 429) };
  }

  const found = await getProfile(env, uuid);
  if (found.busy) {
    return { response: reply({ success: false, message: "Service is busy right now. Please try again.", retry: true }) };
  }
  if (!found.profile) return { response: reply({ success: false, message: "User profile not found" }) };

  const userData = found.profile.user_data || {};
  if (String(userData.pin || "") === "" || String(userData.pin) !== String(pin || "")) {
    if (env.LOCK_KV) {
      const attempts = await readAttempts(env, attemptsKey);
      await env.LOCK_KV.put(attemptsKey, String(attempts + 1), { expirationTtl: PIN_LOCK_SECONDS });
    }
    return { response: reply({ success: false, message: "Incorrect transaction PIN" }) };
  }
  if (env.LOCK_KV) await env.LOCK_KV.delete(attemptsKey);
  return { userData };
}

async function handleVerifyPin(env, body) {
  const { uuid, pin } = body;
  if (!isSafeId(uuid)) return reply({ success: false, message: "Bad Parameters" }, 400);
  if (!/^\d{4}$/.test(String(pin || ""))) {
    return reply({ success: false, message: "Enter your 4 digit transaction PIN" });
  }
  const auth = await authorizePin(env, uuid, pin);
  if (auth.response) return auth.response;
  return reply({ success: true });
}

async function handleRequestWithdraw(env, body) {
  const { uuid, pin, bank_code, bank_name, account_number } = body;
  if (!isSafeId(uuid)) return reply({ success: false, message: "Bad Parameters" }, 400);

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

  const auth = await authorizePin(env, uuid, pin);
  if (auth.response) return auth.response;
  const userData = auth.userData;

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
  if (!resolved.name) return accountFailure(resolved);

  const banks = await loadBanks(env);
  const known = banks ? banks.find((item) => item.code === String(bank_code)) : null;
  const bankLabel = known ? known.name : String(bank_name);

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
      bank_name: bankLabel.slice(0, 80),
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
  if ((await readAttempts(env, attemptsKey)) >= 8) {
    return reply({ success: false, message: "Too many attempts. Try again in 10 minutes" }, 429);
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
        const row = res.data.find((item) => item.user_data && safeEqual(String(item.user_data.password || ""), password));
        if (row) {
          matched = row;
          break;
        }
      }
    }
  }

  if (!matched) {
    if (env.LOCK_KV) {
      const attempts = await readAttempts(env, attemptsKey);
      await env.LOCK_KV.put(attemptsKey, String(attempts + 1), { expirationTtl: PIN_LOCK_SECONDS });
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
      const value = toAmount(row.balance);
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
        map[row.id] = toAmount(row.balance);
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
  const release = () =>
    db(env, `withdrawals?id=eq.${encodeURIComponent(id)}&status=eq.processing`, {
      method: "PATCH",
      body: { status: "pending" }
    });

  const amount = round2(toAmount(withdrawal.amount));
  const debit = await rpc(env, "wallet_debit", {
    p_user: withdrawal.user_id,
    p_amount: amount,
    p_tx: {
      type: "withdrawal",
      direction: "out",
      title: `Withdrawal to ${withdrawal.bank_name || "bank"}`,
      amount,
      status: "success",
      reference: withdrawal.reference,
      created_at: new Date().toISOString()
    }
  });

  let balanceAfter = null;
  if (debit.ok) {
    balanceAfter = round2(Number(debit.data)).toFixed(2);
  } else {
    const message = rpcMessage(debit);
    if (/DUPLICATE_REQUEST/.test(message)) {
      const found = await getProfile(env, withdrawal.user_id);
      if (found.profile) {
        balanceAfter = round2(toAmount((found.profile.user_data || {}).user_balance)).toFixed(2);
      }
    }
    if (balanceAfter === null) {
      await release();
      if (/INSUFFICIENT_FUNDS/.test(message)) {
        return reply({ success: false, message: "User wallet balance is lower than the withdrawal amount" });
      }
      if (/USER_NOT_FOUND/.test(message)) {
        return reply({ success: false, message: "User profile not found" });
      }
      console.error("admin wallet_debit failed", withdrawal.reference, debit.status, message.slice(0, 200));
      return reply({ success: false, message: "Could not debit the wallet. Please try again" });
    }
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
        balance_after: balanceAfter
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

  return reply({ success: true, message: "Payment completed", withdrawal: finalRow, new_balance: balanceAfter });
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
      case "banks":
        return await handleBanks(env);
      case "verify_account":
        return await handleVerifyAccount(env, body);
      case "overview":
        return await handleOverview(env, body);
      case "verify_pin":
        return await handleVerifyPin(env, body);
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
  } catch (err) {
    console.error(err);
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
