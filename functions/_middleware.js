const ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost", "app://localhost"];

export async function onRequest({ request, next }) {
  const o = request.headers.get("Origin");
  const ok = ORIGINS.includes(o);
  const h = {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    Vary: "Origin",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: ok ? h : {} });
  const r = await next();
  if (!ok) return r;
  const n = new Response(r.body, r);
  for (const k in h) n.headers.set(k, h[k]);
  return n;
}
