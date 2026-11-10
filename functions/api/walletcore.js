export const PROVIDER = 'https://bilalsadasub.com';

const LOW_FUNDS = /insufficient|not enough|low balance|low fund|fund your|balance/i;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_SECONDS = 600;
const REFERRAL_PERCENT = 1;
const OWNER_PERCENT = 40;
const OWNER_EMAIL = 'harunalawali5522@gmail.com';
const DB_TIMEOUT = 15000;
const PROVIDER_TIMEOUT = 28000;

export const MSG = {
    network: 'Network problem. Please try again in a few minutes. You have not been charged.',
    failed: 'The purchase could not be completed. You have not been charged.',
    pending: 'Your request is being processed. Please check your history before trying again.',
    server: 'Something went wrong. Please try again.',
    funds: 'Your wallet balance is not enough. Please fund your wallet.',
    locked: 'Too many wrong PIN attempts. Try again in 10 minutes.',
    pin: 'Incorrect PIN. Please try again.',
    details: 'Please check your details and try again.',
    invalid: 'Invalid request.',
    missing: 'Account not found.'
};

export const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const fail = (message, status = 400) => json({ success: false, message: message }, status);

const pendingResponse = () => json({ success: false, pending: true, message: MSG.pending });

export const snippet = (text) => String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').slice(0, 200);
const cleanRoot = (url) => String(url || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
export const toNumber = (v) => parseFloat(String(v === undefined || v === null ? 0 : v).replace(/,/g, '')) || 0;
export const round2 = (n) => Math.round(n * 100) / 100;

export const positiveOrNull = (v) => {
    const n = Number(v);
    return v !== undefined && v !== null && v !== '' && isFinite(n) && n > 0 ? n : null;
};

export const pick = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);

export const isUuid = (v) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(v));

export async function readBody(request) {
    try {
        const body = await request.json();
        return body && typeof body === 'object' ? body : null;
    } catch (err) {
        return null;
    }
}

export function pickRequestId(value) {
    const given = String(value || '');
    return /^[A-Za-z0-9]{16,64}$/.test(given) ? given : crypto.randomUUID().replace(/-/g, '');
}

export function parseList(value) {
    let list = value;
    if (typeof list === 'string') {
        try {
            list = JSON.parse(list);
        } catch (err) {
            list = [];
        }
    }
    return Array.isArray(list) ? list : [];
}

export async function rest(env, path, options) {
    const o = options || {};
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(cleanRoot(env.SUPABASE_URL) + '/rest/v1/' + path, {
        method: o.method || 'GET',
        body: o.body,
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: o.prefer || 'return=minimal' },
        signal: AbortSignal.timeout(DB_TIMEOUT)
    });
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch (err) {
        data = text;
    }
    return { ok: res.ok, status: res.status, data: data };
}

export const rpc = (env, name, args) => rest(env, 'rpc/' + name, { method: 'POST', body: JSON.stringify(args), prefer: 'return=representation' });
const rpcMessage = (r) => (r.data && r.data.message ? String(r.data.message) : '');

export async function firstRow(env, table) {
    const res = await rest(env, table + '?select=*&limit=1');
    if (!res.ok) throw new Error(table + ' ' + res.status);
    return Array.isArray(res.data) && res.data[0] ? res.data[0] : null;
}

async function getProfile(env, uuid) {
    const res = await rest(env, 'user_profiles?id=eq.' + encodeURIComponent(uuid) + '&select=user_data');
    if (!res.ok) throw new Error('profile ' + res.status);
    return Array.isArray(res.data) && res.data[0] ? res.data[0].user_data : null;
}

function findTx(ud, reference) {
    const list = Array.isArray(ud.transactions) ? ud.transactions : [];
    return list.find((t) => t && t.reference === reference) || null;
}

function replay(tx, ud) {
    if (tx.status === 'success') {
        const out = { success: true, message: 'This request was already completed.', balance: toNumber(ud.user_balance) };
        if (tx.token) {
            out.token = tx.token;
            out.units = tx.units || '';
            out.amount = tx.face_amount || tx.amount;
        }
        if (Array.isArray(tx.pins)) out.pins = tx.pins;
        return json(out);
    }
    if (tx.status === 'pending') return pendingResponse();
    return fail(MSG.failed, 200);
}

export async function callProvider(env, path, payload) {
    try {
        const res = await fetch(PROVIDER + path, {
            method: 'POST',
            redirect: 'manual',
            headers: { Authorization: 'Token ' + env.BILAL_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(PROVIDER_TIMEOUT)
        });
        const text = await res.text();
        let data = null;
        try {
            data = JSON.parse(text);
        } catch (err) {
            data = null;
        }
        const status = data && typeof data.status === 'string' ? data.status.toLowerCase() : '';
        const message = data && data.message ? String(data.message) : snippet(text) || 'HTTP ' + res.status;
        if (status === 'success') return { state: 'success', data: data, message: message };
        if (status === 'fail' || status === 'failed' || status === 'error') return { state: 'failed', data: data, message: message };
        if (res.status >= 300 && res.status < 500) return { state: 'failed', data: data, message: message };
        return { state: 'unknown', data: data, message: message };
    } catch (err) {
        return { state: 'unknown', data: null, message: 'no answer from provider' };
    }
}

export async function pricingRule(env, service, itemId) {
    const res = await rest(env, 'bill_pricing?service=eq.' + service + '&item_id=eq.' + encodeURIComponent(itemId) + '&select=mode,value,enabled&limit=1');
    const row = res.ok && Array.isArray(res.data) && res.data[0] ? res.data[0] : null;
    return { mode: row && row.mode === 'fixed' ? 'fixed' : 'percent', value: row ? Number(row.value) || 0 : 0, enabled: row ? row.enabled !== false : true };
}

export function serviceCharge(rule, amount) {
    if (!(rule.value > 0)) return 0;
    return rule.mode === 'fixed' ? round2(rule.value) : round2((amount * rule.value) / 100);
}

export function providerCost(outcome, fallback) {
    const d = outcome.data || {};
    const charged = parseFloat(d.oldbal) - parseFloat(d.newbal);
    return isFinite(charged) && charged > 0 ? round2(charged) : fallback;
}

async function pinLocked(env, uuid) {
    if (!env.LOCK_KV) return false;
    const attempts = parseInt((await env.LOCK_KV.get('pin-attempts:' + uuid)) || '0', 10) || 0;
    return attempts >= MAX_PIN_ATTEMPTS;
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
    return fail(MSG.pin, 403);
}

async function attempt(times, label, fn) {
    for (let i = 0; i < times; i++) {
        try {
            if (await fn()) return true;
        } catch (err) {
            console.error(label + ' error', err && err.message);
        }
    }
    return false;
}

async function recordPending(env, info, reason) {
    try {
        const res = await rest(env, 'pending_profit?on_conflict=reference', {
            method: 'POST',
            body: JSON.stringify({
                reference: info.reference,
                user_id: info.uuid,
                service: info.service,
                description: info.title,
                cost: info.cost,
                price: info.price,
                profit: info.profit,
                reason: snippet(reason),
                status: 'pending'
            }),
            prefer: 'resolution=ignore-duplicates,return=minimal'
        });
        if (!res.ok) console.error('pending_profit failed', info.reference, res.status, snippet(res.data && res.data.message));
    } catch (err) {
        console.error('pending_profit error', info.reference, err && err.message);
    }
}

async function bookkeeping(env, info) {
    try {
        const res = await rest(env, 'profit_log', {
            method: 'POST',
            body: JSON.stringify({
                user_id: info.uuid,
                service: info.service,
                description: info.title,
                reference: info.reference,
                cost: info.cost,
                price: info.price,
                profit: info.profit
            })
        });
        if (!res.ok) console.error('profit_log failed', info.reference, res.status);
    } catch (err) {
        console.error('profit_log error', info.reference, err && err.message);
    }

    if (info.unknown) {
        await recordPending(env, info, 'Provider cost unknown. Enter the profit by hand.');
        return;
    }

    if (!(info.profit > 0)) return;

    let lastError = 'share_profit did not answer';
    const shared = await attempt(3, 'share_profit ' + info.reference, async () => {
        const res = await rpc(env, 'share_profit', {
            p_user: info.uuid,
            p_reference: info.reference,
            p_profit: info.profit,
            p_owner_email: OWNER_EMAIL,
            p_referral_percent: REFERRAL_PERCENT,
            p_owner_percent: OWNER_PERCENT
        });
        if (!res.ok) {
            lastError = 'share_profit ' + res.status + ' ' + snippet(rpcMessage(res));
            console.error('share_profit failed', info.reference, lastError);
            return false;
        }
        if (res.data === false) {
            lastError = 'share_profit returned false';
            console.error('share_profit refused', info.reference);
            return false;
        }
        return true;
    });

    if (!shared) await recordPending(env, info, lastError);
}

export async function processPurchase(context, input) {
    const env = context.env;
    const uuid = input.uuid;
    const reference = input.reference;
    const service = input.service;

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.BILAL_API_KEY) {
        console.error(service + ': missing environment variables');
        return fail(MSG.server, 500);
    }

    let debited = false;

    try {
        if (await pinLocked(env, uuid)) return fail(MSG.locked, 429);

        const ud = await getProfile(env, uuid);
        if (!ud) return fail(MSG.missing, 404);

        const wrongPin = await guardPin(env, uuid, input.pin, ud);
        if (wrongPin) return wrongPin;

        const previous = findTx(ud, reference);
        if (previous) return replay(previous, ud);

        const order = await input.prepare(ud);
        if (order instanceof Response) return order;

        if (toNumber(ud.user_balance) < order.total) return fail(MSG.funds, 400);

        const tx = Object.assign(
            { direction: 'out', amount: order.total, status: 'pending', reference: reference, created_at: new Date().toISOString() },
            order.tx
        );

        let debit;
        try {
            debit = await rpc(env, 'wallet_debit', { p_user: uuid, p_amount: order.total, p_tx: tx });
        } catch (err) {
            console.error(service + ' debit unreachable', reference, err && err.message);
            try {
                await rpc(env, 'wallet_refund', { p_user: uuid, p_reference: reference });
            } catch (inner) {}
            return fail(MSG.server, 500);
        }

        if (!debit.ok) {
            const m = rpcMessage(debit);
            if (/INSUFFICIENT_FUNDS/.test(m)) return fail(MSG.funds, 400);
            if (/DUPLICATE_REQUEST/.test(m)) return pendingResponse();
            if (/USER_NOT_FOUND/.test(m)) return fail(MSG.missing, 404);
            console.error(service + ' wallet_debit failed', debit.status, snippet(m));
            return fail(MSG.server, 500);
        }
        debited = true;
        const balanceAfterDebit = Number(debit.data);

        const payload = Object.assign({}, order.payload, { 'request-id': reference });
        const outcome = await callProvider(env, order.path, payload);

        if (outcome.state === 'success') {
            const done = order.success(outcome);
            const settleArgs = { p_user: uuid, p_reference: reference, p_status: 'success', p_extra: done.extra || {} };
            const settled = await attempt(3, service + ' settle ' + reference, async () => (await rpc(env, 'wallet_settle', settleArgs)).ok);
            if (!settled) console.error(service + ' settle failed', reference);

            const rawCost = typeof order.cost === 'function' ? order.cost(outcome) : order.cost;
            const known = rawCost !== null && rawCost !== undefined && isFinite(rawCost);
            const task = bookkeeping(env, {
                uuid: uuid,
                service: service,
                title: order.tx.title,
                reference: reference,
                cost: known ? round2(rawCost) : 0,
                price: order.total,
                profit: known ? round2(order.total - rawCost) : 0,
                unknown: !known
            });
            if (typeof context.waitUntil === 'function') context.waitUntil(task);
            else await task;

            return json(Object.assign({ success: true, balance: balanceAfterDebit }, done.body));
        }

        if (outcome.state === 'failed') {
            console.error(service + ' provider refused', reference, snippet(outcome.message));
            let refund = null;
            await attempt(2, service + ' refund ' + reference, async () => {
                refund = await rpc(env, 'wallet_refund', { p_user: uuid, p_reference: reference });
                return refund.ok;
            });
            if (!refund || !refund.ok) {
                console.error(service + ' refund failed', reference);
                return pendingResponse();
            }
            return json({
                success: false,
                message: LOW_FUNDS.test(outcome.message) ? MSG.network : order.failed || MSG.failed,
                balance: Number(refund.data)
            });
        }

        console.error(service + ' provider outcome unknown', reference, snippet(outcome.message));
        return pendingResponse();
    } catch (err) {
        console.error(service + ' error', reference, err && err.message);
        if (debited) return pendingResponse();
        return fail(MSG.server, 500);
    }
}
