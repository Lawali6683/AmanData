const PROVIDER = 'https://bilalsadasub.com';
const LOW_FUNDS = /insufficient|not enough|low balance|low fund|fund your|balance/i;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_SECONDS = 600;

const MSG = {
    network: 'Network problem. Please try again in a few minutes. You have not been charged.',
    failed: 'The purchase could not be completed. You have not been charged.',
    pending: 'Your request is being processed. Please check your history before trying again.',
    server: 'Something went wrong. Please try again.'
};

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

function findTx(ud, reference) {
    const list = Array.isArray(ud.transactions) ? ud.transactions : [];
    return list.find((t) => t && t.reference === reference) || null;
}

async function callProvider(env, path, payload) {
    let res;
    try {
        res = await fetch(PROVIDER + path, {
            method: 'POST',
            redirect: 'manual',
            headers: { Authorization: 'Token ' + env.BILAL_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(28000)
        });
    } catch (err) {
        return { state: 'unknown', message: 'no answer from provider' };
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (err) { data = null; }
    const status = data && typeof data.status === 'string' ? data.status.toLowerCase() : '';
    const message = data && data.message ? String(data.message) : snippet(text) || 'HTTP ' + res.status;
    if (status === 'success') return { state: 'success', data: data, message: message };
    if (status === 'fail' || status === 'failed' || status === 'error') return { state: 'failed', data: data, message: message };
    if (res.status >= 300 && res.status < 500) return { state: 'failed', data: data, message: message };
    return { state: 'unknown', data: data, message: message };
}

async function pricingRule(env, service, itemId) {
    const res = await rest(env, 'bill_pricing?service=eq.' + service + '&item_id=eq.' + encodeURIComponent(itemId) + '&select=mode,value,enabled&limit=1');
    const row = res.ok && Array.isArray(res.data) && res.data[0] ? res.data[0] : null;
    return { mode: row && row.mode === 'fixed' ? 'fixed' : 'percent', value: row ? Number(row.value) || 0 : 0, enabled: row ? row.enabled !== false : true };
}

function serviceCharge(rule, amount) {
    if (!(rule.value > 0)) return 0;
    return rule.mode === 'fixed' ? round2(rule.value) : round2((amount * rule.value) / 100);
}

async function guardPin(env, uuid, pin, ud) {
    const key = 'pin-attempts:' + uuid;
    if (String(ud.pin || '') !== '' && String(ud.pin) === pin) {
        if (env.LOCK_KV) await env.LOCK_KV.delete(key);
        return null;
    }
    if (env.LOCK_KV) {
        const attempts = parseInt((await env.LOCK_KV.get(key)) || '0', 10) || 0;
        await env.LOCK_KV.put(key, String(attempts + 1), { expirationTtl: PIN_LOCK_SECONDS });
    }
    return json({ success: false, message: 'Incorrect PIN. Please try again.' }, 403);
}

async function pinLocked(env, uuid) {
    if (!env.LOCK_KV) return false;
    const attempts = parseInt((await env.LOCK_KV.get('pin-attempts:' + uuid)) || '0', 10) || 0;
    return attempts >= MAX_PIN_ATTEMPTS;
}

const NETWORKS = {
    mtn: { id: 1, name: 'MTN' },
    airtel: { id: 2, name: 'AIRTEL' },
    glo: { id: 3, name: 'GLO' },
    '9mobile': { id: 4, name: '9MOBILE' }
};

function replay(tx, ud) {
    if (tx.status === 'success') return json({ success: true, message: 'This purchase was already completed.', balance: toNumber(ud.user_balance) });
    if (tx.status === 'pending') return json({ success: false, pending: true, message: MSG.pending });
    return json({ success: false, message: MSG.failed });
}

export async function onRequestPost({ request, env }) {
    let body;
    try {
        body = await request.json();
    } catch (err) {
        return json({ success: false, message: 'Invalid request.' }, 400);
    }

    const uuid = String(body.uuid || '');
    const pin = String(body.pin || '');
    const phone = String(body.phone || '').trim();
    const amount = Number(body.amount);
    const requestId = String(body.request_id || '');
    const netKey = String(body.network || '');
    const net = NETWORKS[netKey];

    if (!/^[0-9a-fA-F-]{36}$/.test(uuid) || !/^\d{4}$/.test(pin) || !/^(0\d{10}|234\d{10})$/.test(phone) || !net ||
        !Number.isInteger(amount) || amount < 50 || amount > 50000 || !/^[A-Za-z0-9]{16,64}$/.test(requestId)) {
        return json({ success: false, message: 'Please check your details and try again.' }, 400);
    }
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.BILAL_API_KEY) {
        console.error('airtime: missing environment variables');
        return json({ success: false, message: MSG.server }, 500);
    }

    const reference = 'AT_' + requestId;
    let debited = false;
    let balanceAfterDebit = 0;

    try {
        if (await pinLocked(env, uuid)) return json({ success: false, message: 'Too many wrong PIN attempts. Try again in 10 minutes.' }, 429);

        const profileRes = await rest(env, 'user_profiles?id=eq.' + encodeURIComponent(uuid) + '&select=user_data');
        if (!profileRes.ok) throw new Error('profile ' + profileRes.status);
        const ud = profileRes.data && profileRes.data[0] ? profileRes.data[0].user_data : null;
        if (!ud) return json({ success: false, message: 'Account not found.' }, 404);

        const wrongPin = await guardPin(env, uuid, pin, ud);
        if (wrongPin) return wrongPin;

        const previous = findTx(ud, reference);
        if (previous) return replay(previous, ud);

        const rule = await pricingRule(env, 'airtime', netKey);
        if (!rule.enabled) return json({ success: false, message: 'This network is not available right now. Please try again later.' }, 400);

        const fee = serviceCharge(rule, amount);
        const total = round2(amount + fee);
        if (toNumber(ud.user_balance) < total) {
            return json({ success: false, message: 'Your wallet balance is not enough. Please fund your wallet.' }, 400);
        }

        const title = net.name + ' airtime to ' + phone;
        const tx = {
            type: 'airtime purchase',
            direction: 'out',
            title: title,
            amount: total,
            face_amount: amount,
            fee: fee,
            status: 'pending',
            reference: reference,
            created_at: new Date().toISOString()
        };

        const debit = await rpc(env, 'wallet_debit', { p_user: uuid, p_amount: total, p_tx: tx });
        if (!debit.ok) {
            const m = rpcMessage(debit);
            if (/INSUFFICIENT_FUNDS/.test(m)) return json({ success: false, message: 'Your wallet balance is not enough. Please fund your wallet.' }, 400);
            if (/DUPLICATE_REQUEST/.test(m)) return json({ success: false, pending: true, message: MSG.pending });
            if (/USER_NOT_FOUND/.test(m)) return json({ success: false, message: 'Account not found.' }, 404);
            console.error('wallet_debit failed', debit.status, snippet(m));
            return json({ success: false, message: MSG.server }, 500);
        }
        debited = true;
        balanceAfterDebit = Number(debit.data);

        const outcome = await callProvider(env, '/api/topup', {
            network: net.id,
            phone: phone,
            amount: amount,
            plan_type: 'VTU',
            'request-id': reference
        });

        if (outcome.state === 'success') {
            const settleArgs = { p_user: uuid, p_reference: reference, p_status: 'success', p_extra: {} };
            const settle = await rpc(env, 'wallet_settle', settleArgs);
            if (!settle.ok) await rpc(env, 'wallet_settle', settleArgs);
            const charged = parseFloat(outcome.data && outcome.data.oldbal) - parseFloat(outcome.data && outcome.data.newbal);
            const cost = isFinite(charged) && charged > 0 ? charged : amount;
            try {
                await rest(env, 'profit_log', {
                    method: 'POST',
                    body: JSON.stringify({ user_id: uuid, service: 'airtime', description: title, reference: reference, cost: round2(cost), price: total, profit: round2(total - cost) })
                });
            } catch (err) {
                console.error('profit_log failed', err && err.message);
            }
            return json({ success: true, message: '₦' + amount + ' ' + net.name + ' airtime has been sent to ' + phone + '.', balance: balanceAfterDebit });
        }

        if (outcome.state === 'failed') {
            console.error('provider refused airtime', reference, snippet(outcome.message));
            const refund = await rpc(env, 'wallet_refund', { p_user: uuid, p_reference: reference });
            if (!refund.ok) {
                console.error('refund failed', reference, refund.status);
                return json({ success: false, pending: true, message: MSG.pending });
            }
            return json({ success: false, message: LOW_FUNDS.test(outcome.message) ? MSG.network : MSG.failed, balance: Number(refund.data) });
        }

        console.error('provider outcome unknown', reference, snippet(outcome.message));
        return json({ success: false, pending: true, message: MSG.pending });
    } catch (err) {
        console.error('airtime error', err && err.message);
        if (debited) return json({ success: false, pending: true, message: MSG.pending });
        return json({ success: false, message: MSG.server }, 500);
    }
}
