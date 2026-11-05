const SUPABASE_URL = "https://pzyxknmysydjbszumptt.supabase.co";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const DB_TIMEOUT = 12000;
const NOTIFY_TIMEOUT = 10000;

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
    console.error("changepin call error", String(url).split("?")[0], err && err.message);
    return { ok: false, status: 0, data: null };
  }
}

function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function tokenOwner(env, token) {
  const res = await call(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
  });
  if (res.status === 401 || res.status === 403) return { invalid: true };
  if (!res.ok || !res.data || !res.data.id) return { busy: true };
  return { id: String(res.data.id).toLowerCase() };
}

async function getProfile(env, uuid) {
  const url = `${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${encodeURIComponent(uuid)}&select=id,user_data&limit=1`;
  const res = await call(url, { headers: serviceHeaders(env, false) });
  if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) return null;
  return res.data[0];
}

function notify(context, request, profile) {
  const data = (profile && profile.user_data) || {};
  const task = fetch(new URL("/api/email", request.url).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: data.full_name || "", email: data.email || "", action: "Transaction PIN" }),
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT)
  }).catch(() => {});
  if (context && typeof context.waitUntil === "function") context.waitUntil(task);
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

  const uuid = body.uuid;
  const pin = String(body.pin || "");
  if (!isUuid(uuid)) return reply({ success: false, message: "Bad Parameters" }, 400);
  if (!/^\d{4}$/.test(pin)) return reply({ success: false, message: "PIN must be exactly 4 digits" });

  const token = bearer(request);
  if (!token) return reply({ success: false, message: "Please login again to change your PIN" }, 401);

  try {
    const owner = await tokenOwner(env, token);
    if (owner.invalid) return reply({ success: false, message: "Your login has expired. Please login again." }, 401);
    if (owner.busy) return reply({ success: false, message: "Service is busy right now. Please try again.", retry: true });
    if (owner.id !== String(uuid).toLowerCase()) return reply({ success: false, message: "This login does not belong to your account" }, 403);

    const res = await call(`${SUPABASE_URL}/rest/v1/rpc/set_user_pin`, {
      method: "POST",
      headers: serviceHeaders(env, true),
      body: JSON.stringify({ p_user: uuid, p_pin: pin })
    });
    if (!res.ok) return reply({ success: false, message: "Could not save your PIN. Please try again.", retry: true });
    if (res.data === false) return reply({ success: false, message: "User profile not found" });

    const profile = await getProfile(env, uuid);
    notify(context, request, profile);
    return reply({ success: true });
  } catch (err) {
    console.error("changepin handler error", err && err.message);
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
