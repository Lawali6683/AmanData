class AppError extends Error {
    constructor(message, status, detail) {
        super(message);
        this.status = status || 500;
        this.detail = detail || '';
    }
}

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });

const snippet = (text) => String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').slice(0, 300);
const cleanRoot = (url) => String(url || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

async function sha256(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const newApiKey = () => 'amk_' + randomHex(24);

function newApiId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return 'AM' + Array.from(arr).map((b) => chars[b % chars.length]).join('');
}

async function authUser(request, root, key) {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || !root || !key) return null;
    try {
        const res = await fetch(root + '/auth/v1/user', { headers: { apikey: key, Authorization: 'Bearer ' + token } });
        if (!res.ok) return null;
        const user = await res.json();
        return user && user.id && user.email ? { id: String(user.id), email: String(user.email).toLowerCase() } : null;
    } catch (err) {
        return null;
    }
}

export async function onRequestPost({ request, env }) {
    const root = cleanRoot(env.SUPABASE_URL);
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const authRoot = cleanRoot(env.AUTH_SUPABASE_URL || env.SUPABASE_URL);
    const authKey = env.AUTH_SUPABASE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    const debug = String(env.DEBUG_ERRORS || '').toLowerCase() === 'true';

    if (!root || !key) {
        return json({ success: false, message: 'Server setup is incomplete: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in Cloudflare.' }, 500);
    }

    const user = await authUser(request, authRoot, authKey);
    if (!user) return json({ success: false, message: 'Please sign in first.' }, 401);

    let body;
    try {
        body = await request.json();
    } catch (err) {
        return json({ success: false, message: 'Invalid request.' }, 400);
    }

    async function sb(path, options) {
        const opts = options || {};
        let res;
        try {
            res = await fetch(root + '/rest/v1/' + path, {
                method: opts.method || 'GET',
                body: opts.body,
                headers: {
                    apikey: key,
                    Authorization: 'Bearer ' + key,
                    'Content-Type': 'application/json',
                    Prefer: opts.prefer || 'return=representation'
                }
            });
        } catch (err) {
            throw new AppError('Could not reach the database.', 502, snippet(err && err.message));
        }
        const text = await res.text();
        if (!res.ok) throw new AppError('Database error.', 500, res.status + ' on ' + path.split('?')[0] + ': ' + snippet(text));
        return text ? JSON.parse(text) : null;
    }

    try {
        const uid = encodeURIComponent(user.id);
        const rows = await sb('api_resellers?id=eq.' + uid + '&select=*');
        const me = rows && rows[0] ? rows[0] : null;

        if (body.action === 'register') {
            if (me) return json({ success: false, message: 'You already have an API account.' }, 409);
            const businessName = String(body.business_name || '').trim();
            const phone = String(body.phone || '').trim();
            if (businessName.length < 2 || businessName.length > 60 || !/^0\d{10}$/.test(phone)) {
                return json({ success: false, message: 'Please enter a valid business name and an 11-digit phone number.' }, 400);
            }
            const apiKey = newApiKey();
            const keyHash = await sha256(apiKey);
            let created = null;
            let lastError = null;
            for (let attempt = 0; attempt < 4 && !created; attempt++) {
                try {
                    const inserted = await sb('api_resellers', {
                        method: 'POST',
                        body: JSON.stringify({
                            id: user.id,
                            api_id: newApiId(),
                            business_name: businessName,
                            phone: phone,
                            email: user.email,
                            key_hash: keyHash,
                            key_prefix: apiKey.slice(0, 8)
                        })
                    });
                    created = inserted && inserted[0] ? inserted[0] : null;
                } catch (err) {
                    lastError = err;
                    if (!(err instanceof AppError) || !/23505/.test(err.detail) || !/api_id/.test(err.detail)) break;
                }
            }
            if (!created) throw lastError || new AppError('Could not create your account. Please try again.', 500);
            return json({ success: true, message: 'Your API account has been created.', api_id: created.api_id, api_key: apiKey });
        }

        if (!me) return json({ success: false, message: 'No API account found for this login.', needs_register: true }, 404);

        if (body.action === 'dashboard') {
            let orders = [];
            let warning;
            try {
                orders = (await sb('sim_orders?reseller_id=eq.' + uid +
                    '&select=reference,network,phone,plan_name,price,status,created_at&order=created_at.desc&limit=20')) || [];
            } catch (err) {
                warning = debug && err.detail ? 'Orders could not be loaded: ' + err.detail : 'Orders could not be loaded.';
            }
            return json({
                success: true,
                account: {
                    api_id: me.api_id,
                    business_name: me.business_name,
                    phone: me.phone,
                    email: me.email,
                    balance: Number(me.balance),
                    held: Number(me.held),
                    key_prefix: me.key_prefix,
                    status: me.status,
                    created_at: me.created_at
                },
                orders: orders,
                warning: warning
            });
        }

        if (body.action === 'rotate_key') {
            const apiKey = newApiKey();
            await sb('api_resellers?id=eq.' + uid, {
                method: 'PATCH',
                prefer: 'return=minimal',
                body: JSON.stringify({ key_hash: await sha256(apiKey), key_prefix: apiKey.slice(0, 8) })
            });
            return json({ success: true, message: 'A new API key has been created. The old key no longer works.', api_key: apiKey });
        }

        return json({ success: false, message: 'Invalid request.' }, 400);
    } catch (err) {
        const status = err && err.status ? err.status : 500;
        const base = err instanceof AppError ? err.message : 'Something went wrong. Please try again.';
        const detail = debug ? (err instanceof AppError ? err.detail : snippet(err && err.message)) : '';
        return json({ success: false, message: detail ? base + ' ' + detail : base }, status);
    }
}
