const PROVIDER = 'https://bilalsadasub.com';
const COLUMNS = ['wec_data', 'neco_data', 'nabteb_data', 'jamb_data'];
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

function replay(tx, ud) {
    if (tx.status === 'success') {
        return json({
            success: true,
            message: 'This purchase was already completed.',
            pins: Array.isArray(tx.pins) ? tx.pins : [],
            balance: toNumber(ud.user_balance)
        });
    }
    if (tx.status === 'pending') return json({ success: false, pending: true, message: MSG.pending });
    return json({ success: false, message: MSG.failed });
}

async function verifyJamb(env, profile) {
    const form = new URLSearchParams({ profile_id: profile, token: env.BILAL_API_KEY });
    const res = await fetch(PROVIDER + '/api/app/verify_jamb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(20000)
    });
    const data = await res.json();
    return data && data.status === 'success' && data.name ? String(data.name) : '';
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

async function examCost(env, examId) {
    try {
        const res = await fetch(PROVIDER + '/api/v1/plans/exams', {
            headers: { Accept: 'application/json', Authorization: 'Bearer ' + env.BILAL_API_KEY, 'X-API-Key': env.BILAL_API_KEY },
            signal: AbortSignal.timeout(10000)
        });
        const data = await res.json();
        const list = data && Array.isArray(data.data) ? data.data : [];
        const found = list.find((x) => String(x.exam_id) === examId);
        return found ? { amount: Number(found.amount), name: String(found.exam_name || '') } : null;
    } catch (err) {
        return null;
    }
}

export async function onRequestPost({ request, env }) {
    let body;
    try {
        body = await request.json();
    } catch (err) {
        return json({ success: false, message: 'Invalid request.' }, 400);
    }

    const uuid = String(body.uuid || '');
    if (!/^[0-9a-fA-F-]{36}$/.test(uuid)) return json({ success: false, message: 'Invalid request.' }, 400);

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.BILAL_API_KEY) {
        console.error('edu: missing environment variables');
        return json({ success: false, message: MSG.server }, 500);
    }

    if (body.action === 'verify') {
        const profile = String(body.profile_id || '');
        if (!/^\d{8,15}$/.test(profile)) return json({ success: false, message: 'Please enter a valid profile code.' }, 400);
        try {
            const name = await verifyJamb(env, profile);
            if (!name) return json({ success: false, message: 'We could not find a candidate with this profile code.' });
            return json({ success: true, name: name });
        } catch (err) {
            return json({ success: false, message: 'Verification failed. Please try again.' }, 502);
        }
    }

    const pin = String(body.pin || '');
    const phone = String(body.phone || '').trim();
    const examKey = String(body.exam_key || '');
    const examId = String(body.exam_id || '');
    const profileCode = String(body.profile_code || '');
    const requestId = String(body.request_id || '');
    let quantity = Number(body.quantity);

    if (!/^\d{4}$/.test(pin) || !COLUMNS.includes(examKey) || !/^\d{1,3}$/.test(examId) || !/^[A-Za-z0-9]{16,64}$/.test(requestId) || (phone && !/^(0\d{10}|234\d{10})$/.test(phone))) {
        return json({ success: false, message: 'Please check your details and try again.' }, 400);
    }

    const reference = 'Exam_' + requestId;
    const attemptsKey = 'pin-attempts:' + uuid;
    let debited = false;
    let balanceAfterDebit = 0;

    try {
        if (env.LOCK_KV) {
            const attempts = parseInt((await env.LOCK_KV.get(attemptsKey)) || '0', 10) || 0;
            if (attempts >= MAX_PIN_ATTEMPTS) {
                return json({ success: false, message: 'Too many wrong PIN attempts. Try again in 10 minutes.' }, 429);
            }
        }

        const profileRes = await rest(env, 'user_profiles?id=eq.' + encodeURIComponent(uuid) + '&select=user_data');
        if (!profileRes.ok) throw new Error('profile ' + profileRes.status);
        const ud = profileRes.data && profileRes.data[0] ? profileRes.data[0].user_data : null;
        if (!ud) return json({ success: false, message: 'Account not found.' }, 404);

        if (String(ud.pin || '') === '' || String(ud.pin) !== pin) {
            if (env.LOCK_KV) {
                const attempts = parseInt((await env.LOCK_KV.get(attemptsKey)) || '0', 10) || 0;
                await env.LOCK_KV.put(attemptsKey, String(attempts + 1), { expirationTtl: PIN_LOCK_SECONDS });
            }
            return json({ success: false, message: 'Incorrect PIN. Please try again.' }, 403);
        }
        if (env.LOCK_KV) await env.LOCK_KV.delete(attemptsKey);

        const previous = findTx(ud, reference);
        if (previous) return replay(previous, ud);

        const catalogRes = await rest(env, 'exampins?select=*&limit=1');
        if (!catalogRes.ok) throw new Error('exampins ' + catalogRes.status);
        let list = catalogRes.data && catalogRes.data[0] ? catalogRes.data[0][examKey] : [];
        if (typeof list === 'string') {
            try { list = JSON.parse(list); } catch (err) { list = []; }
        }
        const item = Array.isArray(list) ? list.find((x) => String(x.exam_id) === examId) : null;
        const unit = item ? round2(Number(item.price)) : 0;
        if (!item || !(unit > 0)) return json({ success: false, message: 'This exam pin is no longer available.' }, 400);

        const profileMode = item.mode === 'profile_code';
        if (profileMode) {
            if (!/^\d{10}$/.test(profileCode)) return json({ success: false, message: 'Please enter a valid 10-digit profile code.' }, 400);
            quantity = 1;
        } else if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
            return json({ success: false, message: 'Quantity must be between 1 and 10.' }, 400);
        }

        let candidate = '';
        if (profileMode) {
            try {
                candidate = await verifyJamb(env, profileCode);
            } catch (err) {
                return json({ success: false, message: 'Verification failed. Please try again.' }, 502);
            }
            if (!candidate) return json({ success: false, message: 'We could not verify this profile code. You have not been charged.' }, 400);
        }

        const live = await examCost(env, examId);
        const unitCost = live ? live.amount : null;
        const liveName = (live && live.name) || String(item.exam_name || '');
        if (unitCost !== null && unit < unitCost) {
            return json({ success: false, message: 'This exam pin is temporarily unavailable. Please try again later.' }, 400);
        }

        const price = round2(unit * quantity);
        const cost = unitCost === null ? 0 : round2(unitCost * quantity);
        if (toNumber(ud.user_balance) < price) {
            return json({ success: false, message: 'Your wallet balance is not enough. Please fund your wallet.' }, 400);
        }

        const title = liveName + (quantity > 1 ? ' x' + quantity : '') + (candidate ? ' for ' + candidate : '');
        const tx = {
            type: 'exam pin',
            direction: 'out',
            title: title,
            amount: price,
            status: 'pending',
            reference: reference,
            created_at: new Date().toISOString()
        };

        const debit = await rpc(env, 'wallet_debit', { p_user: uuid, p_amount: price, p_tx: tx });
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

        const payload = { exam_id: Number(examId), 'request-id': reference };
        if (phone) payload.phone = phone;
        if (profileMode) {
            payload.profile_code = profileCode;
            payload.jamb_type = /MOCK/i.test(liveName) ? 'MOCK' : (/DIRECT|DE/i.test(liveName) ? 'DE' : 'UTME');
        } else {
            payload.quantity = quantity;
        }

        const outcome = await callProvider(env, '/api/exam', payload);

        if (outcome.state === 'success') {
            const result = outcome.data || {};
            let pins = [];
            if (Array.isArray(result.pins)) pins = result.pins.map((p) => ({ pin: String(p.pin || ''), serial: String(p.serial || '') }));
            else if (result.pin) pins = [{ pin: String(result.pin), serial: '' }];

            const settleArgs = { p_user: uuid, p_reference: reference, p_status: 'success', p_extra: { pins: pins } };
            const settle = await rpc(env, 'wallet_settle', settleArgs);
            if (!settle.ok) await rpc(env, 'wallet_settle', settleArgs);

            try {
                await rest(env, 'profit_log', {
                    method: 'POST',
                    body: JSON.stringify({
                        user_id: uuid,
                        service: 'exam',
                        description: title,
                        reference: reference,
                        cost: cost,
                        price: price,
                        profit: unitCost === null ? 0 : round2(price - cost)
                    })
                });
            } catch (err) {
                console.error('profit_log failed', err && err.message);
            }

            const base = liveName + (quantity > 1 ? ' pins were' : ' pin was') + ' purchased successfully.';
            return json({
                success: true,
                message: pins.length ? base : base + ' If you do not see your pin, check your history.',
                pins: pins,
                balance: balanceAfterDebit
            });
        }

        if (outcome.state === 'failed') {
            console.error('provider refused exam purchase', reference, snippet(outcome.message));
            const refund = await rpc(env, 'wallet_refund', { p_user: uuid, p_reference: reference });
            if (!refund.ok) {
                console.error('refund failed', reference, refund.status);
                return json({ success: false, pending: true, message: MSG.pending });
            }
            const message = LOW_FUNDS.test(outcome.message) ? MSG.network : MSG.failed;
            return json({ success: false, message: message, balance: Number(refund.data) });
        }

        console.error('provider outcome unknown', reference, snippet(outcome.message));
        return json({ success: false, pending: true, message: MSG.pending });
    } catch (err) {
        console.error('edu error', err && err.message);
        if (debited) return json({ success: false, pending: true, message: MSG.pending });
        return json({ success: false, message: MSG.server }, 500);
    }
}
