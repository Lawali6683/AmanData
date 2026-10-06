export const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });

export function dbClient(env) {
    const root = String(env.SUPABASE_URL).replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
    const key = env.SUPABASE_SERVICE_ROLE_KEY;

    async function sb(path, options) {
        const opts = options || {};
        const res = await fetch(root + '/rest/v1/' + path, {
            method: opts.method || 'GET',
            body: opts.body,
            headers: {
                apikey: key,
                Authorization: 'Bearer ' + key,
                'Content-Type': 'application/json',
                Prefer: opts.prefer || 'return=representation'
            }
        });
        if (!res.ok) throw new Error('db ' + res.status);
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    }

    const rpc = (name, args) => sb('rpc/' + name, { method: 'POST', body: JSON.stringify(args) });

    return { root: root, key: key, sb: sb, rpc: rpc };
}

export async function authUser(request, db) {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return null;
    try {
        const res = await fetch(db.root + '/auth/v1/user', { headers: { apikey: db.key, Authorization: 'Bearer ' + token } });
        if (!res.ok) return null;
        const user = await res.json();
        return user && user.id && user.email ? { id: String(user.id), email: String(user.email).toLowerCase() } : null;
    } catch (err) {
        return null;
    }
}

export function isAdmin(env, user) {
    const admins = String(env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    return !!user && admins.includes(user.email);
}

export async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newApiKey() {
    return 'amk_' + randomHex(24);
}

export function newApiId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return 'AM' + Array.from(arr).map((b) => chars[b % chars.length]).join('');
}

const MYAPI_COLUMNS = { mtn: 'mtn_plan', airtel: 'itel_data', glo: 'glo_data', '9mobile': '9mobile_data' };

export async function syncMyapi(db) {
    const slots = (await db.sb('sim_slots?select=network,enabled,remaining_mb')) || [];
    const plans = (await db.sb('sim_plans?select=id,network,size_mb,price,active')) || [];
    const available = new Set();
    plans.forEach((p) => {
        const slot = slots.find((s) => s.network === p.network && s.enabled);
        if (p.active && slot && Number(slot.remaining_mb) >= Number(p.size_mb) && Number(p.price) > 0) available.add(String(p.id));
    });
    const rows = await db.sb('myapi?select=*&limit=1');
    if (!rows || !rows[0]) return;
    const patch = {};
    Object.keys(MYAPI_COLUMNS).forEach((net) => {
        const col = MYAPI_COLUMNS[net];
        let list = rows[0][col];
        if (typeof list === 'string') { try { list = JSON.parse(list); } catch (err) { list = []; } }
        patch[col] = (Array.isArray(list) ? list : []).filter((e) => e && available.has(String(e.plan_id)));
    });
    await db.sb('myapi?id=not.is.null', { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(patch) });
}
