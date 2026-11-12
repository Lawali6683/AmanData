const OWNER_EMAIL = 'harunalawali5522@gmail.com';
const REFERRAL_PERCENT = 1;
const OWNER_PERCENT = 40;
const PIN_SALT = 'amandata.profit.v1:';
const PIN_HASH = 'e6e12f40167a13751524a11e135e5bcfed0802c85e2debca5513da1437c5c8bb';
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_SECONDS = 600;

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const snippet = (text) => String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').slice(0, 220);
const SUPABASE_ROOT = 'https://pzyxknmysydjbszumptt.supabase.co';
const round2 = (n) => Math.round(n * 100) / 100;

async function rest(env, path, options) {
    const o = options || {};
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(SUPABASE_ROOT + '/rest/v1/' + path, {
        method: o.method || 'GET',
        body: o.body,
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: o.prefer || 'return=representation' },
        signal: AbortSignal.timeout(20000)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = text; }
    return { ok: res.ok, status: res.status, data: data };
}

const rpc = (env, name, args) => rest(env, 'rpc/' + name, { method: 'POST', body: JSON.stringify(args) });

function reason(res) {
    const message = res && res.data && res.data.message ? String(res.data.message) : '';
    const code = res && res.data && res.data.code ? String(res.data.code) : '';
    if (code === 'PGRST202' || /Could not find the function|schema cache/i.test(message)) {
        return 'The profit functions are not installed. Run profit_fix.sql in the Supabase SQL editor.';
    }
    if (/OWNER_NOT_FOUND/.test(message)) {
        return OWNER_EMAIL + ' was not found in user_profiles. Check that this email is registered.';
    }
    if (/USER_NOT_FOUND/.test(message)) return 'A wallet account needed for this credit was not found.';
    if (/NO_PROFIT|PROFIT_MUST_BE_ABOVE_ZERO/.test(message)) return 'This item has no profit to share.';
    if (/REFERENCE_REQUIRED/.test(message)) return 'The reference is missing.';
    return snippet(message) || 'Database error ' + (res ? res.status : '');
}

async function sha256(text) {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
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
    if (res.status === 401) return { status: 401, message: 'Supabase rejected your session. Sign in again.' };
    if (!res.ok) return { status: 500, message: 'Access check failed (' + res.status + '): ' + snippet(await res.text()) };
    let allowed = false;
    try { allowed = (await res.json()) === true; } catch (err) { allowed = false; }
    if (!allowed) return { status: 403, message: 'You do not have access to this page.' };
    return null;
}

async function checkPin(env, pin, token) {
    const lockKey = 'profit-pin:' + token.slice(-24);
    if (env.LOCK_KV) {
        const attempts = parseInt((await env.LOCK_KV.get(lockKey)) || '0', 10) || 0;
        if (attempts >= MAX_PIN_ATTEMPTS) return { status: 429, message: 'Too many wrong PIN attempts. Try again in 10 minutes.', code: 'pin' };
    }
    const given = await sha256(PIN_SALT + pin);
    if (given === PIN_HASH) {
        if (env.LOCK_KV) await env.LOCK_KV.delete(lockKey);
        return null;
    }
    if (env.LOCK_KV) {
        const attempts = parseInt((await env.LOCK_KV.get(lockKey)) || '0', 10) || 0;
        await env.LOCK_KV.put(lockKey, String(attempts + 1), { expirationTtl: PIN_LOCK_SECONDS });
    }
    return { status: 403, message: 'Incorrect PIN.', code: 'pin' };
}

export async function onRequestPost({ request, env }) {
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
        return json({ success: false, message: 'Server setup is incomplete: SUPABASE_SERVICE_ROLE_KEY is missing in Cloudflare.' }, 500);
    }
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ success: false, message: 'Please sign in first.' }, 401);

    const denied = await checkAdmin(SUPABASE_ROOT, env.SUPABASE_SERVICE_ROLE_KEY, token);
    if (denied) return json({ success: false, message: denied.message }, denied.status);

    let body;
    try {
        body = await request.json();
    } catch (err) {
        return json({ success: false, message: 'Invalid request.' }, 400);
    }

    const badPin = await checkPin(env, String(body.pin || ''), token);
    if (badPin) return json({ success: false, code: badPin.code, message: badPin.message }, badPin.status);

    try {
        if (body.action === 'queue') {
            const queue = await rpc(env, 'admin_profit_queue', {});
            if (!queue.ok) return json({ success: false, message: reason(queue) }, 500);
            const items = Array.isArray(queue.data) ? queue.data : [];
            let found = false;
            const lookup = await rest(env, 'user_profiles?select=id&user_data->>email=ilike.' + encodeURIComponent(OWNER_EMAIL) + '&limit=1');
            if (lookup.ok && Array.isArray(lookup.data) && lookup.data.length > 0) found = true;
            return json({
                success: true,
                items: items,
                owner: { email: OWNER_EMAIL, found: found },
                percents: { referral: REFERRAL_PERCENT, owner: OWNER_PERCENT }
            });
        }

        if (body.action === 'credit') {
            const list = Array.isArray(body.items) ? body.items : [];
            if (!list.length || list.length > 100) return json({ success: false, message: 'Invalid request.' }, 400);

            const results = [];
            const seen = {};
            let credited = 0;
            let ownerTotal = 0;

            for (const raw of list) {
                const reference = String((raw && raw.reference) || '');
                if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(reference)) {
                    results.push({ reference: reference, ok: false, message: 'This item has an invalid reference.' });
                    continue;
                }
                if (seen[reference]) {
                    results.push({ reference: reference, ok: false, message: 'This item was sent twice.' });
                    continue;
                }
                seen[reference] = true;

                let res;
                try {
                    res = await rpc(env, 'admin_credit_profit', {
                        p_reference: reference,
                        p_owner_email: OWNER_EMAIL,
                        p_referral_percent: REFERRAL_PERCENT,
                        p_owner_percent: OWNER_PERCENT
                    });
                } catch (err) {
                    results.push({ reference: reference, ok: false, message: 'Could not reach the database: ' + snippet(err && err.message) });
                    continue;
                }

                if (!res.ok) {
                    results.push({ reference: reference, ok: false, message: reason(res) });
                    continue;
                }
                const data = res.data && typeof res.data === 'object' ? res.data : {};
                const ownerAmount = Number(data.owner_amount) || 0;
                credited += 1;
                ownerTotal += ownerAmount;
                results.push({
                    reference: reference,
                    ok: true,
                    already: data.already === true,
                    owner_amount: ownerAmount,
                    referral_amount: Number(data.referral_amount) || 0
                });
            }

            return json({
                success: true,
                credited: credited,
                failed: results.length - credited,
                owner_total: round2(ownerTotal),
                results: results
            });
        }

        return json({ success: false, message: 'Invalid request.' }, 400);
    } catch (err) {
        console.error('adminprofit error', err && err.message);
        return json({ success: false, message: 'Something went wrong: ' + snippet(err && err.message) }, 502);
    }
}
