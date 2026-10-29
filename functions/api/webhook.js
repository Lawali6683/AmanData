const PAYSTACK_API = "https://api.paystack.co";
const SWEEP_BATCH = 20;
const SWEEP_GAP_MS = 10 * 60 * 1000;
const SWEEP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const jsonResponse = (data, status) =>
  new Response(JSON.stringify(data), {
    status: status,
    headers: { "Content-Type": "application/json" }
  });

const getBaseUrl = (value) => {
  let base = (value || "https://pzyxknmysydjbszumptt.supabase.co").trim();
  base = base.replace(/\/+$/, "").replace(/\/rest\/v1$/, "").replace(/\/+$/, "");
  return base;
};

const safeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

const digits10 = (value) => {
  const s = String(value === undefined || value === null ? "" : value).trim();
  return /^\d{10}$/.test(s) ? s : "";
};

const errText = (e, fallback) => (e && e.message ? String(e.message) : fallback);

const describeIdentity = (identity) =>
  "account=" + (identity.accounts.join("|") || "-") +
  " customer=" + (identity.customerCode || "-") +
  " email=" + (identity.email || "-");

function buildConfig(env) {
  const secret = env.PAYSTACK_API_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !serviceKey) return null;
  return {
    secret: secret,
    supabaseUrl: getBaseUrl(env.SUPABASE_URL),
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json"
    }
  };
}

async function sbFetch(cfg, path, options) {
  const o = options || {};
  const headers = Object.assign({}, cfg.headers);
  if (o.prefer) headers["Prefer"] = o.prefer;
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    method: o.method || "GET",
    headers: headers,
    body: o.body
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }
  return { ok: res.ok, status: res.status, data: data };
}

function extractIdentity(eventData, verified) {
  const accounts = [];
  let customerCode = "";
  let email = "";
  const sources = [verified || {}, eventData || {}];
  for (const src of sources) {
    const auth = src.authorization && typeof src.authorization === "object" ? src.authorization : {};
    const meta = src.metadata && typeof src.metadata === "object" ? src.metadata : {};
    const dedicated = src.dedicated_account && typeof src.dedicated_account === "object" ? src.dedicated_account : {};
    const customer = src.customer && typeof src.customer === "object" ? src.customer : {};
    [auth.receiver_bank_account_number, meta.receiver_account_number, dedicated.account_number].forEach((v) => {
      const a = digits10(v);
      if (a && accounts.indexOf(a) === -1) accounts.push(a);
    });
    if (!customerCode && customer.customer_code) customerCode = String(customer.customer_code).trim();
    if (!email && customer.email) email = String(customer.email).trim().toLowerCase();
  }
  return { accounts: accounts, customerCode: customerCode, email: email };
}

async function findUser(cfg, identity) {
  const accountTries = identity.accounts.length ? identity.accounts : [""];
  let rpcWorked = false;

  for (const account of accountTries) {
    const res = await sbFetch(cfg, "rpc/find_user_for_deposit", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({
        p_account: account,
        p_customer_code: identity.customerCode,
        p_email: identity.email
      })
    });
    if (res.ok) {
      rpcWorked = true;
      if (Array.isArray(res.data) && res.data[0] && res.data[0].user_id) {
        return { id: res.data[0].user_id, by: res.data[0].matched_by };
      }
    }
  }

  if (rpcWorked || !identity.email) return null;

  const exact = await sbFetch(
    cfg,
    `user_profiles?select=id,user_data&user_data->>email=eq.${encodeURIComponent(identity.email)}&limit=2`
  );
  let profiles = exact.ok && Array.isArray(exact.data) ? exact.data : [];

  if (profiles.length === 0 && exact.ok) {
    const loose = await sbFetch(
      cfg,
      `user_profiles?select=id,user_data&user_data->>email=ilike.${encodeURIComponent(identity.email)}&limit=5`
    );
    const rows = loose.ok && Array.isArray(loose.data) ? loose.data : [];
    profiles = rows.filter(
      (p) => p.user_data && p.user_data.email && String(p.user_data.email).trim().toLowerCase() === identity.email
    );
  }

  if (profiles.length === 1) return { id: profiles[0].id, by: "email" };
  return null;
}

async function processCharge(cfg, reference, eventData) {
  let verifyRes;
  let verifyJson = null;
  try {
    verifyRes = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${cfg.secret}` },
      signal: AbortSignal.timeout(15000)
    });
    try {
      verifyJson = await verifyRes.json();
    } catch (e) {}
  } catch (e) {
    return { status: "error", message: "Paystack verify unreachable: " + errText(e, "network error") };
  }

  if (!verifyRes.ok || !verifyJson || verifyJson.status !== true || !verifyJson.data) {
    return {
      status: "error",
      message: verifyJson && verifyJson.message ? `Paystack verify failed: ${verifyJson.message}` : "Paystack verify failed"
    };
  }

  const verified = verifyJson.data;
  const channel = verified.channel || (eventData && eventData.channel) || "";

  if (verified.status !== "success") return { status: "ignored", message: "Transaction not successful" };
  if (channel !== "dedicated_nuban") return { status: "ignored", message: "Not a virtual account transfer" };

  if (verified.currency && verified.currency !== "NGN") {
    return { status: "rejected", message: "Unsupported currency: " + verified.currency };
  }

  const grossKobo = Number(verified.amount);
  if (!Number.isInteger(grossKobo) || grossKobo <= 0) {
    return { status: "rejected", message: "Invalid verified amount" };
  }

  const feeKobo = Math.round(grossKobo / 100);
  const netKobo = grossKobo - feeKobo;
  if (netKobo <= 0) return { status: "rejected", message: "Net amount after fee is not positive" };

  const grossNaira = grossKobo / 100;
  const feeNaira = feeKobo / 100;
  const netNaira = netKobo / 100;

  const identity = extractIdentity(eventData, verified);

  let user = null;
  try {
    user = await findUser(cfg, identity);
  } catch (e) {
    return { status: "error", message: "User lookup failed: " + errText(e, "lookup error"), amount: grossNaira, email: identity.email };
  }

  if (!user) {
    return {
      status: "unmatched",
      message: "UNMATCHED " + describeIdentity(identity),
      amount: grossNaira,
      email: identity.email
    };
  }

  const creditRes = await sbFetch(cfg, "rpc/credit_wallet", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({
      p_user_id: user.id,
      p_email: identity.email || "",
      p_reference: reference,
      p_gross: grossNaira,
      p_fee: feeNaira,
      p_net: netNaira
    })
  });

  if (!creditRes.ok) {
    const detail = typeof creditRes.data === "string" ? creditRes.data : JSON.stringify(creditRes.data || {});
    return {
      status: "error",
      message: "Wallet credit failed: " + detail.slice(0, 300),
      amount: grossNaira,
      email: identity.email
    };
  }

  if (creditRes.data === "duplicate") return { status: "duplicate", userId: user.id, by: user.by };
  return { status: "credited", userId: user.id, by: user.by };
}

async function markResolved(cfg, reference) {
  try {
    await sbFetch(cfg, `failed_webhooks?reference=eq.${encodeURIComponent(reference)}&resolved=eq.false`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ resolved: true, resolved_at: new Date().toISOString() })
    });
  } catch (e) {}
}

async function logFailed(cfg, payload, reference, info, resolved) {
  try {
    const existing = await sbFetch(
      cfg,
      `failed_webhooks?select=reference&reference=eq.${encodeURIComponent(reference)}&resolved=eq.false&limit=1`
    );
    if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) return;

    const now = new Date().toISOString();
    const base = {
      email: info.email || "",
      amount: isNaN(Number(info.amount)) ? 0 : Number(info.amount),
      reference: reference,
      raw_payload: payload,
      reason: info.message || "Unknown failure",
      created_at: now
    };
    const extended = Object.assign({}, base, { resolved: !!resolved, attempts: 1, last_attempt_at: now });

    const first = await sbFetch(cfg, "failed_webhooks", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify(extended)
    });
    if (!first.ok) {
      await sbFetch(cfg, "failed_webhooks", {
        method: "POST",
        prefer: "return=minimal",
        body: JSON.stringify(base)
      });
    }
  } catch (e) {}
}

async function sweep(cfg) {
  const now = Date.now();
  const oldest = new Date(now - SWEEP_MAX_AGE_MS).toISOString();
  const gap = new Date(now - SWEEP_GAP_MS).toISOString();

  const list = await sbFetch(
    cfg,
    "failed_webhooks?select=reference,attempts&resolved=eq.false&raw_payload->>event=eq.charge.success" +
      `&created_at=gte.${oldest}&or=(last_attempt_at.is.null,last_attempt_at.lt.${gap})` +
      `&order=created_at.asc&limit=${SWEEP_BATCH}`
  );

  if (!list.ok || !Array.isArray(list.data)) {
    return { checked: 0, credited: 0, resolved: 0, pending: 0, note: "pending list unavailable" };
  }

  const seen = {};
  const rows = list.data.filter((r) => {
    if (!r.reference || seen[r.reference]) return false;
    seen[r.reference] = true;
    return true;
  });

  let credited = 0;
  let resolvedCount = 0;
  let pending = 0;

  for (const row of rows) {
    try {
      await sbFetch(cfg, `failed_webhooks?reference=eq.${encodeURIComponent(row.reference)}&resolved=eq.false`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ attempts: (Number(row.attempts) || 0) + 1, last_attempt_at: new Date().toISOString() })
      });

      const result = await processCharge(cfg, row.reference, null);

      if (result.status === "credited") {
        credited++;
        resolvedCount++;
        await markResolved(cfg, row.reference);
      } else if (result.status === "duplicate" || result.status === "ignored" || result.status === "rejected") {
        resolvedCount++;
        await markResolved(cfg, row.reference);
      } else {
        pending++;
      }
    } catch (e) {
      pending++;
    }
  }

  return { checked: rows.length, credited: credited, resolved: resolvedCount, pending: pending };
}

async function handle(request, env, ctx) {
  const cfg = buildConfig(env);
  if (!cfg) {
    return jsonResponse({ success: false, message: "Server is not configured." }, 500);
  }

  if (request.method === "GET") {
    const key = new URL(request.url).searchParams.get("sweep") || "";
    if (env.SWEEP_KEY && key && safeEqual(key, String(env.SWEEP_KEY))) {
      const summary = await sweep(cfg);
      return jsonResponse(Object.assign({ success: true }, summary), 200);
    }
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const signature = request.headers.get("x-paystack-signature");
  if (!signature) {
    return new Response("Unauthorized: Missing Signature", { status: 401 });
  }

  const rawBody = await request.text();

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(cfg.secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(rawBody));
  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (!safeEqual(computedSignature, signature.trim().toLowerCase())) {
    return new Response("Unauthorized: Invalid Signature", { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return new Response("Bad Request: Invalid JSON", { status: 400 });
  }

  if (payload.event !== "charge.success") {
    return new Response("Event ignored", { status: 200 });
  }

  const eventData = payload.data || {};
  const reference = eventData.reference ? String(eventData.reference) : "";

  if (!reference) {
    return new Response("Bad Request: Missing reference", { status: 400 });
  }

  let result;
  try {
    result = await processCharge(cfg, reference, eventData);
  } catch (e) {
    result = { status: "error", message: errText(e, "System runtime execution crash") };
  }

  let response;

  if (result.status === "credited" || result.status === "duplicate") {
    await markResolved(cfg, reference);
    response = new Response(result.status === "duplicate" ? "Transaction already processed" : "Webhook processed successfully", { status: 200 });
  } else if (result.status === "ignored") {
    response = new Response("Event ignored: " + result.message, { status: 200 });
  } else if (result.status === "rejected") {
    await logFailed(cfg, payload, reference, result, true);
    response = new Response("Rejected and logged", { status: 200 });
  } else if (result.status === "unmatched") {
    await logFailed(cfg, payload, reference, result, false);
    response = new Response("User not found, deposit stored and will be retried", { status: 200 });
  } else {
    await logFailed(cfg, payload, reference, result, false);
    response = jsonResponse({ success: false, message: result.message }, 500);
  }

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(sweep(cfg).catch(() => {}));
  }

  return response;
}

export async function onRequest(context) {
  return handle(context.request, context.env, context);
}

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx);
  }
};
