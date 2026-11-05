const SUPABASE_URL = "https://pzyxknmysydjbszumptt.supabase.co";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 600;
const DB_TIMEOUT = 12000;
const AUTH_TIMEOUT = 12000;
const NOTIFY_TIMEOUT = 10000;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 72;

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-fA-F-]{36}$/.test(value);
}

function serviceHeaders(env, json) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

async function call(url, options) {
  try {
    const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(DB_TIMEOUT) }, options));
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
    console.error("pin call error", String(url).split("?")[0], err && err.message);
    return { ok: false, status: 0, data: null };
  }
}

async function getProfile(env, uuid) {
  const url = `${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${encodeURIComponent(uuid)}&select=id,user_data&limit=1`;
  const res = await call(url, { headers: serviceHeaders(env, false) });
  if (!res.ok) return { busy: true };
  if (!Array.isArray(res.data) || res.data.length === 0) return { profile: null };
  return { profile: res.data[0] };
}

async function checkCredentials(env, email, password) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: serviceHeaders(env, true),
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(AUTH_TIMEOUT)
    });
    if (res.status === 400 || res.status === 401 || res.status === 422) return { ok: false, wrong: true };
    if (!res.ok) return { ok: false, wrong: false };
    const data = await res.json();
    return { ok: true, id: data && data.user && data.user.id, email: data && data.user && data.user.email };
  } catch (err) {
    console.error("pin auth error", err && err.message);
    return { ok: false, wrong: false };
  }
}

async function readAttempts(env, key) {
  if (!env.LOCK_KV) return 0;
  try {
    return parseInt(await env.LOCK_KV.get(key), 10) || 0;
  } catch {
    return 0;
  }
}

async function authorize(env, body) {
  const uuid = body.uuid;
  const email = String(body.email || "").trim();
  const current = String(body.current_password || "");

  if (!isUuid(uuid)) return { response: reply({ success: false, message: "Bad Parameters" }, 400) };
  if (!email || !current) return { response: reply({ success: false, message: "Email and current password are required" }) };

  const key = `cred-attempts:${uuid}`;
  if ((await readAttempts(env, key)) >= MAX_ATTEMPTS) {
    return { response: reply({ success: false, message: "Too many wrong attempts. Try again in 10 minutes" }, 429) };
  }

  const found = await getProfile(env, uuid);
  if (found.busy) return { response: reply({ success: false, message: "Service is busy right now. Please try again.", retry: true }) };
  if (!found.profile) return { response: reply({ success: false, message: "User profile not found" }) };

  const storedEmail = String((found.profile.user_data || {}).email || "").trim().toLowerCase();
  const checked = await checkCredentials(env, email, current);
  if (!checked.ok && !checked.wrong) {
    return { response: reply({ success: false, message: "Could not check your credentials right now. Please try again.", retry: true }) };
  }

  const matches =
    checked.ok &&
    String(checked.id || "").toLowerCase() === String(uuid).toLowerCase() &&
    (storedEmail === "" || storedEmail === email.toLowerCase());

  if (!matches) {
    if (env.LOCK_KV) {
      const attempts = await readAttempts(env, key);
      await env.LOCK_KV.put(key, String(attempts + 1), { expirationTtl: LOCK_SECONDS });
    }
    return { response: reply({ success: false, message: "Invalid email or password" }) };
  }

  if (env.LOCK_KV) await env.LOCK_KV.delete(key);
  return { profile: found.profile };
}

function notify(context, request, profile, action) {
  const data = profile.user_data || {};
  const task = fetch(new URL("/api/email", request.url).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: data.full_name || "", email: data.email || "", action }),
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT)
  }).catch(() => {});
  if (context && typeof context.waitUntil === "function") context.waitUntil(task);
}

async function handlePin(env, context, request, body) {
  const pin = String(body.pin || "");
  if (!/^\d{4}$/.test(pin)) return reply({ success: false, message: "PIN must be exactly 4 digits" });

  const auth = await authorize(env, body);
  if (auth.response) return auth.response;

  const res = await call(`${SUPABASE_URL}/rest/v1/rpc/set_user_pin`, {
    method: "POST",
    headers: serviceHeaders(env, true),
    body: JSON.stringify({ p_user: body.uuid, p_pin: pin })
  });
  if (!res.ok) return reply({ success: false, message: "Could not save your PIN. Please try again.", retry: true });
  if (res.data === false) return reply({ success: false, message: "User profile not found" });

  notify(context, request, auth.profile, "Transaction PIN");
  return reply({ success: true });
}

async function handlePassword(env, context, request, body) {
  const next = String(body.new_password || "");
  if (next.length < MIN_PASSWORD) return reply({ success: false, message: `Password must be at least ${MIN_PASSWORD} characters` });
  if (next.length > MAX_PASSWORD) return reply({ success: false, message: `Password must be at most ${MAX_PASSWORD} characters` });
  if (next === String(body.current_password || "")) return reply({ success: false, message: "New password must be different from the current one" });

  const auth = await authorize(env, body);
  if (auth.response) return auth.response;

  const res = await call(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(body.uuid)}`, {
    method: "PUT",
    headers: serviceHeaders(env, true),
    body: JSON.stringify({ password: next })
  });
  if (!res.ok) {
    const weak = res.status === 422;
    return reply({
      success: false,
      message: weak ? "This password is not accepted. Choose a stronger one." : "Could not change your password. Please try again.",
      retry: !weak
    });
  }

  notify(context, request, auth.profile, "Login Password");
  return reply({ success: true });
}

async function handle(context, request, env) {
  if (request.method !== "POST") return reply({ success: false, message: "Method Not Allowed" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return reply({ success: false, message: "Bad Request" }, 400);
  }

  const required = env.REQ_PASS || "@haruna66";
  if (!body || (body.password !== required && body.req_pass !== required)) {
    return reply({ success: false, message: "Unauthorized Access" }, 401);
  }

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return reply({ success: false, message: "Server is not configured" }, 500);
  }

  try {
    if (body.type === "verify") {
      const auth = await authorize(env, body);
      if (auth.response) return auth.response;
      return reply({ success: true });
    }
    if (body.type === "pin") return await handlePin(env, context, request, body);
    if (body.type === "password") return await handlePassword(env, context, request, body);
    return reply({ success: false, message: "Unknown request" }, 400);
  } catch (err) {
    console.error("pin handler error", err && err.message);
    return reply({ success: false, message: "Server error. Please try again." }, 500);
  }
}

export async function onRequest(context) {
  return handle(context, context.request, context.env);
}

export default {
  async fetch(request, env, context) {
    return handle(context, request, env);
  }
};
