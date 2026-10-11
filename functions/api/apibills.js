const PROVIDER = 'https://bilalsadasub.com';
const NETWORKS = [
    { item_id: 'mtn', name: 'MTN', logo: '' },
    { item_id: 'airtel', name: 'AIRTEL', logo: '' },
    { item_id: 'glo', name: 'GLO', logo: '' },
    { item_id: '9mobile', name: '9MOBILE', logo: '' }
];
const SERVICES = ['airtime', 'electricity'];

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const snippet = (text) => String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').slice(0, 200);
const cleanRoot = (url) => String(url || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const toNumber = (v) => parseFloat(String(v === undefined || v === null ? 0 : v).replace(/,/g, '')) || 0;
const round2 = (n) => Math.round(n * 100) / 100;

async function rest(env, path, options) {
    const o = options || {};
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(cleanRoot(env.SUPABASE_URL) + '/rest/v1/' + path, {
        method: o.method || 'GET',
        body: o.body,
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: o.prefer || 'return=minimal' }
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = text; }
    return { ok: res.ok, status: res.status, data: data };
}

const rpc = (env, name, args) => rest(env, 'rpc/' + name, { method: 'POST', body: JSON.stringify(args), prefer: 'return=representation' });
const rpcMessage = (r) => (r.data && r.data.message ? String(r.data.message) : '');


async function liveItems(env, service) {
    if (service === 'airtime') return NETWORKS;
    let res;
    try {
        res = await fetch(PROVIDER + '/api/v1/plans/discos', {
            headers: { Accept: 'application/json', Authorization: 'Bearer ' + env.BILAL_API_KEY, 'X-API-Key': env.BILAL_API_KEY },
            signal: AbortSignal.timeout(12000)
        });
    } catch (err) {
        throw new Error('Could not connect to Bilal: ' + snippet(err && err.message));
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (err) { data = null; }
    if (!res.ok || !data || !Array.isArray(data.data)) {
        throw new Error('Bilal returned ' + res.status + ' for the electricity list: ' + snippet(text));
    }
    return data.data.map((d) => ({ item_id: String(d.plan_id), name: String(d.disco_name || ''), logo: d.logo ? String(d.logo) : '' }));
}

async function checkAdmin(root, key, token) {
    let res;
    try {
        res = await fetch(root + '/rest/v1/rpc/is_admin_user', {
            method: 'POST',
            headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: '{}'
        });
    } catch (err) {
        return { status: 500, message: 'Could not reach Supabase to verify your access: ' + snippet(err && err.message) };
    }
    if (res.status === 401) return { status: 401, message: 'Supabase rejected your session. Sign in again. If this keeps happening, set AUTH_SUPABASE_URL and AUTH_SUPABASE_KEY.' };
    if (!res.ok) return { status: 500, message: 'Access check failed (' + res.status + '): ' + snippet(await res.text()) };
    let allowed = false;
    try { allowed = (await res.json()) === true; } catch (err) { allowed = false; }
    if (!allowed) return { status: 403, message: 'You do not have access to this page.' };
    return null;
}

export async function onRequestPost({ request, env }) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        return json({ success: false, message: 'Server setup is incomplete: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in Cloudflare.' }, 500);
    }
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ success: false, message: 'Please sign in first.' }, 401);

    const denied = await checkAdmin(cleanRoot(env.AUTH_SUPABASE_URL || env.SUPABASE_URL), env.AUTH_SUPABASE_KEY || env.SUPABASE_SERVICE_ROLE_KEY, token);
    if (denied) return json({ success: false, message: denied.message }, denied.status);

    let body;
    try {
        body = await request.json();
    } catch (err) {
        return json({ success: false, message: 'Invalid request.' }, 400);
    }

    const service = String(body.service || '');
    if (!SERVICES.includes(service)) return json({ success: false, message: 'Invalid request.' }, 400);

    try {
        const items = await liveItems(env, service);

        if (body.action === 'load') {
            const res = await rest(env, 'bill_pricing?service=eq.' + service + '&select=item_id,mode,value,enabled');
            if (!res.ok) {
                return json({ success: false, message: 'Database ' + res.status + ' on bill_pricing: ' + snippet(res.data && res.data.message) + '. Run pricing.sql in Supabase.' }, 500);
            }
            const saved = {};
            (Array.isArray(res.data) ? res.data : []).forEach((r) => { saved[String(r.item_id)] = r; });
            return json({
                success: true,
                service: service,
                items: items.map((it) => {
                    const r = saved[it.item_id];
                    return {
                        item_id: it.item_id,
                        name: it.name,
                        logo: it.logo,
                        mode: r && r.mode === 'fixed' ? 'fixed' : 'percent',
                        value: r ? Number(r.value) || 0 : 0,
                        enabled: r ? r.enabled !== false : true,
                        saved: Boolean(r)
                    };
                })
            });
        }

        if (body.action === 'save') {
            const list = Array.isArray(body.items) ? body.items : [];
            if (!list.length || list.length > 200) return json({ success: false, message: 'Invalid request.' }, 400);
            const names = {};
            items.forEach((it) => { names[it.item_id] = it.name; });
            const rows = [];
            for (const raw of list) {
                const id = String(raw.item_id || '');
                const mode = raw.mode === 'fixed' ? 'fixed' : 'percent';
                const value = Number(raw.value);
                if (!names[id] || !isFinite(value) || value < 0 || value > 100000 || (mode === 'percent' && value > 100)) continue;
                rows.push({ service: service, item_id: id, item_name: names[id], mode: mode, value: round2(value), enabled: raw.enabled !== false, updated_at: new Date().toISOString() });
            }
            if (!rows.length) return json({ success: false, message: 'No valid items to save.' }, 400);
            const res = await rest(env, 'bill_pricing?on_conflict=service,item_id', {
                method: 'POST',
                body: JSON.stringify(rows),
                prefer: 'resolution=merge-duplicates,return=minimal'
            });
            if (!res.ok) {
                return json({ success: false, message: 'Database ' + res.status + ' on bill_pricing: ' + snippet(res.data && res.data.message) }, 500);
            }
            return json({ success: true, message: rows.length + ' item(s) saved successfully.' });
        }

        return json({ success: false, message: 'Invalid request.' }, 400);
    } catch (err) {
        console.error('apibills error', err && err.message);
        return json({ success: false, message: snippet(err && err.message) || 'Something went wrong. Please try again.' }, 502);
    }
}
