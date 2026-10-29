const PAYSTACK_API = "https://api.paystack.co";
const SWEEP_BATCH = 20;
const SWEEP_GAP_MS = 10 * 60 * 1000;
const SWEEP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const EVENT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const SCAN_PAGE = 1000;
const SCAN_MAX_PAGES = 50;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-admin-key",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};

const jsonResponse = (data, status) =>
  new Response(JSON.stringify(data), {
    status: status,
    headers: { "Content-Type": "application/json" }
  });

const adminJson = (data, status) =>
  new Response(JSON.stringify(data), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, CORS)
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

const cleanEmail = (value) => String(value === undefined || value === null ? "" : value).trim().toLowerCase().replace(/\s+/g, "");
const errText = (e, fallback) => (e && e.message ? String(e.message) : fallback);
const toNaira = (kobo) => Number((Number(kobo) / 100).toFixed(2));
const pickChannel = (src) => (src && (src.channel || (src.authorization && src.authorization.channel))) || "";

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
    keyMode: String(secret).indexOf("sk_live") === 0 ? "live" : (String(secret).indexOf("sk_test") === 0 ? "test" : "unknown"),
    adminKey: env.ADMIN_KEY ? String(env.ADMIN_KEY) : "",
    sweepKey: env.SWEEP_KEY ? String(env.SWEEP_KEY) : "",
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

async function signBody(secret, text) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const buffer = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(text));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function logEvent(cfg, row) {
  try {
    await sbFetch(cfg, "webhook_events", {
      method: "POST",
      prefer: "return=minimal",
      body: JSON.stringify(row)
    });
  } catch (e) {}
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
    if (!email && customer.email) email = cleanEmail(customer.email);
  }
  return { accounts: accounts, customerCode: customerCode, email: email };
}

async function findUser(cfg, identity, accountOnly) {
  if (accountOnly && identity.accounts.length === 0) return null;
  const accountTries = identity.accounts.length ? identity.accounts : [""];
  let rpcWorked = false;

  for (const account of accountTries) {
    const res = await sbFetch(cfg, "rpc/find_user_for_deposit", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({
        p_account: account,
        p_customer_code: accountOnly ? "" : identity.customerCode,
        p_email: accountOnly ? "" : identity.email
      })
    });
    if (res.ok) {
      rpcWorked = true;
      if (Array.isArray(res.data) && res.data[0] && res.data[0].user_id) {
        return { id: res.data[0].user_id, by: res.data[0].matched_by };
      }
    }
  }

  if (rpcWorked || accountOnly || !identity.email) return null;

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
    profiles = rows.filter((p) => p.user_data && cleanEmail(p.user_data.email) === identity.email);
  }

  if (profiles.length === 1) return { id: profiles[0].id, by: "email" };
  return null;
}

async function scanUsers(cfg, identity, accountOnly) {
  const wantedAccounts = identity.accounts;
  const wantedCode = accountOnly ? "" : identity.customerCode;
  const wantedEmail = accountOnly ? "" : cleanEmail(identity.email);
  const byAccount = [];
  const byCode = [];
  const byEmail = [];
  let lastId = "";

  for (let page = 0; page < SCAN_MAX_PAGES; page++) {
    const res = await sbFetch(
      cfg,
      "user_profiles?select=id,email:user_data->>email,code:user_data->>paystack_customer_code,accounts:user_data->virtual_accounts" +
        `&order=id.asc&limit=${SCAN_PAGE}` + (lastId ? `&id=gt.${encodeURIComponent(lastId)}` : "")
    );
    if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) break;

    for (const row of res.data) {
      if (
        Array.isArray(row.accounts) &&
        row.accounts.some((a) => a && wantedAccounts.indexOf(String(a.accountNumber || "").trim()) !== -1)
      ) {
        byAccount.push(row.id);
      }
      if (wantedCode && row.code && String(row.code).trim() === wantedCode) byCode.push(row.id);
      if (wantedEmail && row.email && cleanEmail(row.email) === wantedEmail) byEmail.push(row.id);
    }

    lastId = res.data[res.data.length - 1].id;
    if (res.data.length < SCAN_PAGE) break;
  }

  const tiers = [["scan-account", byAccount], ["scan-customer", byCode], ["scan-email", byEmail]];
  for (const tier of tiers) {
    if (tier[1].length === 1) return { user: { id: tier[1][0], by: tier[0] } };
    if (tier[1].length > 1) return { ambiguous: true };
  }
  return {};
}

async function resolveCharge(cfg, reference, signed) {
  let verified = null;
  let verifyNote = "";

  try {
    const res = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${cfg.secret}` },
      signal: AbortSignal.timeout(10000)
    });
    let json = null;
    try {
      json = await res.json();
    } catch (e) {}
    if (res.ok && json && json.status === true && json.data) {
      verified = json.data;
    } else {
      verifyNote = "verify unavailable: " + (json && json.message ? json.message : "HTTP " + res.status);
    }
  } catch (e) {
    verifyNote = "verify unreachable: " + errText(e, "network error");
  }

  if (!verified && !signed) {
    return { status: "error", message: verifyNote || "No transaction data available" };
  }

  const base = verified || signed;

  if (base.status !== "success") return { status: "ignored", message: "Transaction not successful" };

  if (verified && signed && signed.amount !== undefined && Number(signed.amount) !== Number(verified.amount)) {
    return { status: "rejected", message: "Amount mismatch between webhook and Paystack verify" };
  }

  if (base.currency && base.currency !== "NGN") {
    return { status: "rejected", message: "Unsupported currency: " + base.currency };
  }

  const grossKobo = Number(base.amount);
  if (!Number.isInteger(grossKobo) || grossKobo <= 0) {
    return { status: "rejected", message: "Invalid amount" };
  }

  const feeKobo = Math.round(grossKobo / 100);
  const netKobo = grossKobo - feeKobo;
  if (netKobo <= 0) return { status: "rejected", message: "Net amount after fee is not positive" };

  const channel = pickChannel(verified) || pickChannel(signed);

  return {
    status: "ok",
    gross: toNaira(grossKobo),
    fee: toNaira(feeKobo),
    net: toNaira(netKobo),
    channel: channel,
    viaDva: channel === "dedicated_nuban",
    verifiedBy: verified ? "paystack" : "signature",
    note: verifyNote,
    identity: extractIdentity(signed, verified)
  };
}

async function creditUser(cfg, userId, reference, charge, by) {
  const res = await sbFetch(cfg, "rpc/credit_wallet", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({
      p_user_id: userId,
      p_email: charge.identity.email || "",
      p_reference: reference,
      p_gross: charge.gross,
      p_fee: charge.fee,
      p_net: charge.net
    })
  });

  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data || {});
    return {
      status: "error",
      message: "Wallet credit failed: " + detail.slice(0, 300),
      amount: charge.gross,
      email: charge.identity.email
    };
  }

  return {
    status: res.data === "duplicate" ? "duplicate" : "credited",
    userId: userId,
    by: by,
    gross: charge.gross,
    fee: charge.fee,
    net: charge.net,
    verifiedBy: charge.verifiedBy,
    account: charge.identity.accounts[0] || "",
    email: charge.identity.email
  };
}

async function processCharge(cfg, reference, signed, broad) {
  let charge;
  try {
    charge = await resolveCharge(cfg, reference, signed);
  } catch (e) {
    return { status: "error", message: "Charge check failed: " + errText(e, "unknown error") };
  }
  if (charge.status !== "ok") return charge;

  const identity = charge.identity;
  const accountOnly = !charge.viaDva;

  if (accountOnly && identity.accounts.length === 0) {
    return {
      status: "ignored",
      message: "Not a virtual account transfer (channel=" + (charge.channel || "none") + ")",
      amount: charge.gross,
      email: identity.email
    };
  }

  let user = null;
  let ambiguous = false;

  try {
    user = await findUser(cfg, identity, accountOnly);
    if (!user && broad) {
      const scanned = await scanUsers(cfg, identity, accountOnly);
      if (scanned.user) user = scanned.user;
      if (scanned.ambiguous) ambiguous = true;
    }
  } catch (e) {
    return {
      status: "error",
      message: "User lookup failed: " + errText(e, "lookup error"),
      amount: charge.gross,
      email: identity.email
    };
  }

  if (!user) {
    if (accountOnly) {
      return {
        status: "ignored",
        message: "Not a virtual account transfer and no matching account (channel=" + (charge.channel || "none") + ")",
        amount: charge.gross,
        email: identity.email
      };
    }
    return {
      status: "unmatched",
      message: (ambiguous ? "AMBIGUOUS " : "UNMATCHED ") + describeIdentity(identity) + " channel=" + charge.channel,
      amount: charge.gross,
      email: identity.email,
      account: identity.accounts[0] || ""
    };
  }

  return creditUser(cfg, user.id, reference, charge, user.by);
}

async function clearPending(cfg, reference) {
  try {
    await sbFetch(cfg, `failed_webhooks?reference=eq.${encodeURIComponent(reference)}`, {
      method: "DELETE",
      prefer: "return=minimal"
    });
  } catch (e) {}
}

async function logFailed(cfg, payload, reference, info) {
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
    const extended = Object.assign({}, base, { resolved: false, attempts: 1, last_attempt_at: now });

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

async function claimRow(cfg, row, gapIso) {
  const res = await sbFetch(
    cfg,
    `failed_webhooks?reference=eq.${encodeURIComponent(row.reference)}&resolved=eq.false` +
      `&or=(last_attempt_at.is.null,last_attempt_at.lt.${gapIso})`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify({ attempts: (Number(row.attempts) || 0) + 1, last_attempt_at: new Date().toISOString() })
    }
  );
  return res.ok && Array.isArray(res.data) && res.data.length > 0;
}

async function sweep(cfg) {
  const now = Date.now();
  const oldest = new Date(now - SWEEP_MAX_AGE_MS).toISOString();
  const gap = new Date(now - SWEEP_GAP_MS).toISOString();

  try {
    await sbFetch(cfg, `webhook_events?received_at=lt.${new Date(now - EVENT_KEEP_MS).toISOString()}`, {
      method: "DELETE",
      prefer: "return=minimal"
    });
  } catch (e) {}

  const list = await sbFetch(
    cfg,
    "failed_webhooks?select=reference,attempts,raw_payload&resolved=eq.false&raw_payload->>event=eq.charge.success" +
      `&created_at=gte.${oldest}&or=(last_attempt_at.is.null,last_attempt_at.lt.${gap})` +
      `&order=created_at.asc&limit=${SWEEP_BATCH}`
  );

  if (!list.ok || !Array.isArray(list.data)) {
    return { checked: 0, credited: 0, cleared: 0, pending: 0, note: "pending list unavailable" };
  }

  const seen = {};
  const rows = list.data.filter((r) => {
    if (!r.reference || seen[r.reference]) return false;
    seen[r.reference] = true;
    return true;
  });

  let credited = 0;
  let cleared = 0;
  let pending = 0;

  for (const row of rows) {
    try {
      const claimed = await claimRow(cfg, row, gap);
      if (!claimed) continue;

      const signed = row.raw_payload && row.raw_payload.data ? row.raw_payload.data : null;
      const result = await processCharge(cfg, row.reference, signed, false);

      if (result.status === "credited" || result.status === "duplicate") {
        if (result.status === "credited") credited++;
        cleared++;
        await clearPending(cfg, row.reference);
        await logEvent(cfg, {
          stage: result.status,
          reference: row.reference,
          event: "charge.success",
          amount: result.gross || null,
          email: result.email || null,
          account: result.account || null,
          detail: "retried later by sweep, matched by " + result.by
        });
      } else if (result.status === "ignored" || result.status === "rejected") {
        cleared++;
        await clearPending(cfg, row.reference);
      } else {
        pending++;
      }
    } catch (e) {
      pending++;
    }
  }

  return { checked: rows.length, credited: credited, cleared: cleared, pending: pending };
}

async function handleWebhook(request, cfg, ctx) {
  const signature = request.headers.get("x-paystack-signature");
  const rawBody = await request.text();

  if (!signature) {
    await logEvent(cfg, { stage: "no_signature", detail: "POST without x-paystack-signature, body length " + rawBody.length });
    return new Response("Unauthorized: Missing Signature", { status: 401 });
  }

  const computed = await signBody(cfg.secret, rawBody);
  if (!safeEqual(computed, signature.trim().toLowerCase())) {
    await logEvent(cfg, {
      stage: "bad_signature",
      detail: "Signature mismatch. Server key mode: " + cfg.keyMode + ". Body length " + rawBody.length + ". Check that the Paystack key in the environment matches the dashboard mode (live or test) that sends this webhook."
    });
    return new Response("Unauthorized: Invalid Signature", { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    await logEvent(cfg, { stage: "rejected", detail: "Signed request but body is not JSON" });
    return new Response("Bad Request: Invalid JSON", { status: 400 });
  }

  const eventName = payload && payload.event ? String(payload.event) : "";
  const data = payload && payload.data && typeof payload.data === "object" ? payload.data : {};
  const reference = data.reference ? String(data.reference) : "";
  const identity = extractIdentity(data, null);
  const info = {
    event: eventName || null,
    reference: reference || null,
    channel: pickChannel(data) || null,
    amount: isFinite(Number(data.amount)) && data.amount !== undefined ? toNaira(data.amount) : null,
    email: identity.email || null,
    account: identity.accounts[0] || null
  };

  if (eventName !== "charge.success") {
    await logEvent(cfg, Object.assign({ stage: "ignored_event", detail: "Event not handled: " + (eventName || "none") }, info));
    return new Response("Event ignored", { status: 200 });
  }

  if (!reference) {
    await logEvent(cfg, Object.assign({ stage: "rejected", detail: "charge.success without reference", payload: payload }, info));
    return new Response("Bad Request: Missing reference", { status: 400 });
  }

  let result;
  try {
    result = await processCharge(cfg, reference, data, false);
  } catch (e) {
    result = { status: "error", message: errText(e, "System runtime execution crash") };
  }

  let response;

  if (result.status === "credited" || result.status === "duplicate") {
    await Promise.all([
      clearPending(cfg, reference),
      logEvent(cfg, Object.assign({}, info, {
        stage: result.status,
        amount: result.gross,
        email: result.email || info.email,
        account: result.account || info.account,
        detail: (result.status === "credited" ? "credited" : "already processed") +
          " by " + result.by + "; checked by " + result.verifiedBy +
          "; gross " + result.gross + " fee " + result.fee + " net " + result.net
      }))
    ]);
    response = new Response(result.status === "duplicate" ? "Transaction already processed" : "Webhook processed successfully", { status: 200 });
  } else if (result.status === "ignored") {
    await logEvent(cfg, Object.assign({}, info, { stage: "ignored", detail: result.message, payload: payload }));
    response = new Response("Event ignored: " + result.message, { status: 200 });
  } else if (result.status === "rejected") {
    await logEvent(cfg, Object.assign({}, info, { stage: "rejected", detail: result.message, payload: payload }));
    response = new Response("Rejected and logged", { status: 200 });
  } else if (result.status === "unmatched") {
    await Promise.all([
      logFailed(cfg, payload, reference, result),
      logEvent(cfg, Object.assign({}, info, { stage: "unmatched", detail: result.message, payload: payload }))
    ]);
    response = new Response("User not found, deposit stored for admin and retry", { status: 200 });
  } else {
    await Promise.all([
      logFailed(cfg, payload, reference, result),
      logEvent(cfg, Object.assign({}, info, { stage: "error", detail: result.message, payload: payload }))
    ]);
    response = jsonResponse({ success: false, message: result.message }, 500);
  }

  if (ctx && typeof ctx.waitUntil === "function" && Math.random() < 0.2) {
    ctx.waitUntil(sweep(cfg).catch(() => {}));
  }

  return response;
}

function summarizeRow(row) {
  const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const identity = extractIdentity(data, null);
  const customer = data.customer && typeof data.customer === "object" ? data.customer : {};
  const auth = data.authorization && typeof data.authorization === "object" ? data.authorization : {};
  return {
    reference: row.reference,
    amount: data.amount !== undefined ? toNaira(data.amount) : Number(row.amount) || 0,
    reason: row.reason || "",
    created_at: row.created_at || "",
    attempts: Number(row.attempts) || 0,
    channel: pickChannel(data),
    account: identity.accounts[0] || "",
    customer_code: identity.customerCode,
    email: identity.email || row.email || "",
    customer_name: [customer.first_name, customer.last_name].filter(Boolean).join(" "),
    sender_name: auth.sender_name || "",
    narration: auth.narration || ""
  };
}

async function listPending(cfg) {
  let res = await sbFetch(
    cfg,
    "failed_webhooks?select=reference,email,amount,reason,created_at,attempts,raw_payload&resolved=eq.false" +
      "&raw_payload->>event=eq.charge.success&order=created_at.desc&limit=100"
  );
  if (!res.ok) {
    res = await sbFetch(
      cfg,
      "failed_webhooks?select=reference,email,amount,reason,created_at,raw_payload" +
        "&raw_payload->>event=eq.charge.success&order=created_at.desc&limit=100"
    );
  }
  return res.ok && Array.isArray(res.data) ? res.data : [];
}

async function getPendingRow(cfg, reference) {
  const res = await sbFetch(
    cfg,
    `failed_webhooks?select=reference,email,amount,reason,created_at,raw_payload&reference=eq.${encodeURIComponent(reference)}&limit=1`
  );
  return res.ok && Array.isArray(res.data) && res.data[0] ? res.data[0] : null;
}

async function diagnose(cfg) {
  const checks = {
    paystack_key_mode: cfg.keyMode,
    admin_key_set: !!cfg.adminKey,
    sweep_key_set: !!cfg.sweepKey
  };

  try {
    const res = await fetch(`${PAYSTACK_API}/balance`, {
      headers: { "Authorization": `Bearer ${cfg.secret}` },
      signal: AbortSignal.timeout(10000)
    });
    checks.paystack_key_valid = res.ok;
  } catch (e) {
    checks.paystack_key_valid = false;
  }

  const events = await sbFetch(cfg, "webhook_events?select=id&limit=1");
  checks.webhook_events_table = events.ok;

  const failed = await sbFetch(cfg, "failed_webhooks?select=reference,resolved,attempts,last_attempt_at&limit=1");
  checks.failed_webhooks_ready = failed.ok;

  const credits = await sbFetch(cfg, "paystack_credits?select=reference&limit=1");
  checks.paystack_credits_table = credits.ok;

  const finder = await sbFetch(cfg, "rpc/find_user_for_deposit", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({ p_account: "0000000000", p_customer_code: "", p_email: "" })
  });
  checks.find_user_function = finder.ok;

  const credit = await sbFetch(cfg, "rpc/credit_wallet", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_email: "",
      p_reference: "diagnose_" + Date.now(),
      p_gross: 0,
      p_fee: 0,
      p_net: 0
    })
  });
  const creditText = typeof credit.data === "string" ? credit.data : JSON.stringify(credit.data || {});
  checks.credit_wallet_function = !credit.ok && /user_not_found/.test(creditText);

  return checks;
}

async function handleAdmin(request, cfg) {
  const given = request.headers.get("x-admin-key") || "";
  if (!cfg.adminKey || !safeEqual(given, cfg.adminKey)) {
    return adminJson({ success: false, message: "Unauthorized." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return adminJson({ success: false, message: "Invalid request." }, 400);
  }

  const action = String(body.action || "");

  if (action === "diagnose") {
    return adminJson({ success: true, checks: await diagnose(cfg) }, 200);
  }

  if (action === "list") {
    const pending = (await listPending(cfg)).map(summarizeRow);
    const events = await sbFetch(
      cfg,
      "webhook_events?select=id,received_at,stage,reference,event,channel,amount,email,account,detail&order=received_at.desc&limit=60"
    );
    return adminJson({
      success: true,
      pending: pending,
      events: events.ok && Array.isArray(events.data) ? events.data : [],
      events_available: events.ok
    }, 200);
  }

  if (action === "search") {
    const q = String(body.q || "").replace(/[^a-zA-Z0-9@._+\- ]/g, "").trim();
    if (q.length < 3) return adminJson({ success: false, message: "Type at least 3 characters." }, 400);
    const enc = encodeURIComponent(q);
    const res = await sbFetch(
      cfg,
      "user_profiles?select=id,email:user_data->>email,name:user_data->>full_name,phone:user_data->>phone_number,accounts:user_data->virtual_accounts" +
        `&or=(user_data->>email.ilike.*${enc}*,user_data->>full_name.ilike.*${enc}*,user_data->>phone_number.ilike.*${enc}*)&limit=15`
    );
    if (!res.ok) return adminJson({ success: false, message: "Search failed." }, 500);
    return adminJson({ success: true, users: Array.isArray(res.data) ? res.data : [] }, 200);
  }

  const reference = String(body.reference || "");
  if (!reference) return adminJson({ success: false, message: "Missing reference." }, 400);

  if (action === "delete") {
    await clearPending(cfg, reference);
    return adminJson({ success: true, message: "Deleted." }, 200);
  }

  const row = await getPendingRow(cfg, reference);
  if (!row) return adminJson({ success: false, message: "This deposit record was not found. It may already be handled." }, 404);
  const signed = row.raw_payload && row.raw_payload.data ? row.raw_payload.data : null;

  if (action === "retry") {
    const result = await processCharge(cfg, reference, signed, true);
    if (result.status === "credited" || result.status === "duplicate") {
      await clearPending(cfg, reference);
      await logEvent(cfg, {
        stage: result.status,
        reference: reference,
        event: "charge.success",
        amount: result.gross || null,
        email: result.email || null,
        account: result.account || null,
        detail: "admin retry, matched by " + result.by + ", net " + result.net
      });
      return adminJson({ success: true, status: result.status, message: result.status === "credited" ? "User credited: " + result.net : "Already credited before." }, 200);
    }
    await sbFetch(cfg, `failed_webhooks?reference=eq.${encodeURIComponent(reference)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ reason: "ADMIN RETRY: " + (result.message || result.status) })
    });
    return adminJson({ success: false, status: result.status, message: result.message || "Could not credit." }, 200);
  }

  if (action === "credit") {
    const userId = String(body.user_id || "");
    if (!UUID_RE.test(userId)) return adminJson({ success: false, message: "Invalid user id." }, 400);

    const userRes = await sbFetch(cfg, `user_profiles?select=id&id=eq.${encodeURIComponent(userId)}&limit=1`);
    if (!userRes.ok || !Array.isArray(userRes.data) || userRes.data.length === 0) {
      return adminJson({ success: false, message: "User not found." }, 404);
    }

    const charge = await resolveCharge(cfg, reference, signed);
    if (charge.status !== "ok") return adminJson({ success: false, status: charge.status, message: charge.message }, 200);

    const result = await creditUser(cfg, userId, reference, charge, "admin");
    if (result.status === "credited" || result.status === "duplicate") {
      await clearPending(cfg, reference);
      await logEvent(cfg, {
        stage: result.status,
        reference: reference,
        event: "charge.success",
        amount: result.gross || null,
        email: charge.identity.email || null,
        account: charge.identity.accounts[0] || null,
        detail: "admin manual credit to " + userId + ", net " + result.net
      });
      return adminJson({ success: true, status: result.status, message: result.status === "credited" ? "User credited: " + result.net : "Already credited before." }, 200);
    }
    return adminJson({ success: false, status: result.status, message: result.message }, 200);
  }

  return adminJson({ success: false, message: "Unknown action." }, 400);
}

async function handle(request, env, ctx) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const cfg = buildConfig(env);
  if (!cfg) {
    return jsonResponse({ success: false, message: "Server is not configured." }, 500);
  }

  try {
    if (request.method === "GET") {
      const key = new URL(request.url).searchParams.get("sweep") || "";
      if (cfg.sweepKey && key && safeEqual(key, cfg.sweepKey)) {
        const summary = await sweep(cfg);
        return jsonResponse(Object.assign({ success: true }, summary), 200);
      }
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (request.headers.get("x-admin-key") !== null) {
      return await handleAdmin(request, cfg);
    }

    return await handleWebhook(request, cfg, ctx);
  } catch (e) {
    await logEvent(cfg, { stage: "crash", detail: errText(e, "Unknown crash") });
    return jsonResponse({ success: false, message: "Internal error" }, 500);
  }
}

export async function onRequest(context) {
  return handle(context.request, context.env, context);
}

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx);
  }
};
