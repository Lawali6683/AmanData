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

async function getProfile(env, uuid) {
    const res = await rest(env, 'user_profiles?id=eq.' + encodeURIComponent(uuid) + '&select=user_data');
    if (!res.ok) throw new Error('profile ' + res.status);
    return res.data && res.data[0] ? res.data[0].user_data : null;
}

async function gate(env, uuid, pin) {
    if (await pinLocked(env, uuid)) {
        return { response: json({ success: false, message: 'Too many wrong PIN attempts. Try again in 10 minutes.' }, 429) };
    }
    const ud = await getProfile(env, uuid);
    if (!ud) return { response: json({ success: false, message: 'Account not found.' }, 404) };
    const wrong = await guardPin(env, uuid, pin, ud);
    if (wrong) return { response: wrong };
    return { ud: ud };
}

function replay(tx, ud, okMessage, extra) {
    if (tx.status === 'success') {
        return json(Object.assign({ success: true, message: okMessage, balance: toNumber(ud.user_balance) }, extra || {}));
    }
    if (tx.status === 'pending') return json({ success: false, pending: true, message: MSG.pending });
    return json({ success: false, message: MSG.failed });
}

function debitError(debit) {
    const m = rpcMessage(debit);
    if (/INSUFFICIENT_FUNDS/.test(m)) return json({ success: false, message: 'Your wallet balance is not enough. Please fund your wallet.' }, 400);
    if (/DUPLICATE_REQUEST/.test(m)) return json({ success: false, pending: true, message: MSG.pending });
    if (/USER_NOT_FOUND/.test(m)) return json({ success: false, message: 'Account not found.' }, 404);
    console.error('wallet_debit failed', debit.status, snippet(m));
    return json({ success: false, message: MSG.server }, 500);
}

async function settleSuccess(env, uuid, reference, extra) {
    const args = { p_user: uuid, p_reference: reference, p_status: 'success', p_extra: extra || {} };
    const first = await rpc(env, 'wallet_settle', args);
    if (!first.ok) {
        const second = await rpc(env, 'wallet_settle', args);
        if (!second.ok) console.error('settle failed', reference, second.status);
    }
}

async function refundResponse(env, uuid, reference, outcome) {
    console.error('provider refused', reference, snippet(outcome.message));
    const refund = await rpc(env, 'wallet_refund', { p_user: uuid, p_reference: reference });
    if (!refund.ok) {
        console.error('refund failed', reference, refund.status);
        return json({ success: false, pending: true, message: MSG.pending });
    }
    return json({ success: false, message: LOW_FUNDS.test(outcome.message) ? MSG.network : MSG.failed, balance: Number(refund.data) });
}

async function shareProfit(env, uuid, reference, profit) {
    if (!(profit > 0)) return;
    const args = {
        p_reference: reference,
        p_user: uuid,
        p_profit: round2(profit),
        p_investor_email: String(env.INVESTOR_EMAIL || '').trim().toLowerCase()
    };
    for (let i = 0; i < 3; i++) {
        try {
            const res = await rpc(env, 'distribute_profit', args);
            if (res.ok) {
                if (res.data === 'investor_not_found') console.error('profit share: investor not found', reference);
                return;
            }
            console.error('distribute_profit failed', reference, res.status, snippet(rpcMessage(res)));
        } catch (err) {
            console.error('distribute_profit error', reference, err && err.message);
        }
    }
}

async function recordProfit(env, uuid, service, description, reference, cost, price) {
    const known = cost !== null && cost !== undefined && isFinite(cost);
    const profit = known ? round2(price - cost) : 0;
    try {
        await rest(env, 'profit_log', {
            method: 'POST',
            body: JSON.stringify({
                user_id: uuid,
                service: service,
                description: description,
                reference: reference,
                cost: known ? round2(cost) : 0,
                price: round2(price),
                profit: profit
            })
        });
    } catch (err) {
        console.error('profit_log failed', err && err.message);
    }
    await shareProfit(env, uuid, reference, profit);
}

const PROVIDERS = {
    DSTV: { id: 2, live: 'DSTV', match: 'DSTV', name: 'DSTV' },
    GOTV: { id: 1, live: 'GOTV', match: 'GOTV', name: 'GOTV' },
    STARTIMES: { id: 3, live: 'STARTIME', match: 'STARTIME', name: 'STARTIMES' }
};

export async function onRequestPost({ request, env }) {
    let body;
    try {
        body = await request.json();
    } catch (err) {
        return json({ success: false, message: 'Invalid request.' }, 400);
    }

    const uuid = String(body.uuid || '');
    const pin = String(body.pin || '');
    const iuc = String(body.iuc || '').trim();
    const phone = String(body.phone || '').trim();
    const planId = String(body.plan_id || '');
    const prov = PROVIDERS[String(body.provider || '')];
    const requestId = String(body.request_id || '') || crypto.randomUUID().replace(/-/g, '');

    if (!/^[0-9a-fA-F-]{36}$/.test(uuid) || !/^\d{4}$/.test(pin) || !/^\d{10}$/.test(iuc) || !planId || !prov ||
        (phone && !/^(0\d{10}|234\d{10})$/.test(phone)) || !/^[A-Za-z0-9]{16,64}$/.test(requestId)) {
        return json({ success: false, message: 'Please check your details and try again.' }, 400);
    }
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.BILAL_API_KEY) {
        console.error('tv: missing environment variables');
        return json({ success: false, message: MSG.server }, 500);
    }

    const reference = 'Cable_' + requestId;
    let debited = false;
    let balanceAfterDebit = 0;

    try {
        const access = await gate(env, uuid, pin);
        if (access.response) return access.response;
        const ud = access.ud;

        const previous = findTx(ud, reference);
        if (previous) return replay(previous, ud, 'This renewal was already completed.');

        const plansRes = await rest(env, 'cabletv?select=*&limit=1');
        if (!plansRes.ok) throw new Error('plans ' + plansRes.status);
        let list = Array.isArray(plansRes.data) && plansRes.data[0] ? plansRes.data[0].alltv_plan : [];
        if (typeof list === 'string') list = JSON.parse(list);
        const plan = Array.isArray(list)
            ? list.find((p) => String(p.plan_id) === planId && String(p.cable_name || '').toUpperCase().indexOf(prov.match) === 0)
            : null;
        const price = plan ? round2(Number(plan.price)) : 0;
        if (!plan || !(price > 0)) return json({ success: false, message: 'This package is no longer available.' }, 400);

        let cost = null;
        try {
            const costRes = await fetch(PROVIDER + '/api/v1/plans/cable?cable=' + prov.live, { signal: AbortSignal.timeout(12000) });
            const costJson = await costRes.json();
            const found = costJson && Array.isArray(costJson.data) ? costJson.data.find((p) => String(p.plan_id) === planId) : null;
            if (found && isFinite(Number(found.plan_price))) cost = Number(found.plan_price);
        } catch (err) {
            cost = null;
        }
        if (cost !== null && price < cost) {
            return json({ success: false, message: 'This package is temporarily unavailable. Please try again later.' }, 400);
        }

        if (toNumber(ud.user_balance) < price) {
            return json({ success: false, message: 'Your wallet balance is not enough. Please fund your wallet.' }, 400);
        }

        const title = prov.name + ' ' + plan.plan_name + ' for ' + iuc;
        const tx = {
            type: 'tv subscription',
            direction: 'out',
            title: title,
            amount: price,
            status: 'pending',
            reference: reference,
            created_at: new Date().toISOString()
        };

        const debit = await rpc(env, 'wallet_debit', { p_user: uuid, p_amount: price, p_tx: tx });
        if (!debit.ok) return debitError(debit);
        debited = true;
        balanceAfterDebit = Number(debit.data);

        const payload = { cable: prov.id, iuc: iuc, plan_id: Number(planId), 'request-id': reference };
        if (phone) payload.phone = phone;
        const outcome = await callProvider(env, '/api/cable', payload);

        if (outcome.state === 'success') {
            await settleSuccess(env, uuid, reference, {});
            await recordProfit(env, uuid, 'cable', title, reference, cost, price);
            return json({ success: true, message: plan.plan_name + ' has been renewed for ' + iuc + '.', balance: balanceAfterDebit });
        }

        if (outcome.state === 'failed') return await refundResponse(env, uuid, reference, outcome);

        console.error('provider outcome unknown', reference, snippet(outcome.message));
        return json({ success: false, pending: true, message: MSG.pending });
    } catch (err) {
        console.error('tv error', err && err.message);
        if (debited) return json({ success: false, pending: true, message: MSG.pending });
        return json({ success: false, message: MSG.server }, 500);
    }
}
