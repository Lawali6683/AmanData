import { MSG, fail, isUuid, readBody, pickRequestId, pick, firstRow, parseList, positiveOrNull, round2, processPurchase, PROVIDER } from './walletcore.js';

const NETWORKS = {
    mtn_plan: { id: 1, name: 'MTN' },
    itel_data: { id: 2, name: 'AIRTEL' },
    glo_data: { id: 3, name: 'GLO' },
    '9mobile_data': { id: 4, name: 'T2' }
};

function providerHeaders(env) {
    const headers = { Accept: 'application/json' };
    if (env.BILAL_API_KEY) {
        headers.Authorization = 'Bearer ' + env.BILAL_API_KEY;
        headers['X-API-Key'] = env.BILAL_API_KEY;
    }
    return headers;
}

async function fetchLiveCost(env, network, planId) {
    const res = await fetch(PROVIDER + '/api/v1/plans/data?network=' + network, {
        headers: providerHeaders(env),
        signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const list = data && Array.isArray(data.data) ? data.data : [];
    const found = list.find((p) => String(p.plan_id) === planId);
    return found ? positiveOrNull(found.amount) : null;
}

async function liveCost(env, network, planId) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const cost = await fetchLiveCost(env, network, planId);
            if (cost !== null) return cost;
        } catch (err) {}
    }
    return null;
}

async function storedCost(env, netKey, planId) {
    try {
        const row = await firstRow(env, 'aipbuydata');
        const plan = parseList(row ? row[netKey] : null).find((p) => String(p.plan_id) === planId);
        return plan ? positiveOrNull(plan.amount) : null;
    } catch (err) {
        return null;
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;

    const body = await readBody(request);
    if (!body) return fail(MSG.invalid, 400);

    const uuid = String(body.uuid || '');
    const pin = String(body.pin || '');
    const phone = String(body.phone || '').trim();
    const planId = String(body.plan_id || '');
    const netKey = String(body.network_key || '');
    const net = pick(NETWORKS, netKey);

    if (!isUuid(uuid) || !/^\d{4}$/.test(pin) || !/^(0\d{10}|234\d{10})$/.test(phone) || !/^\d{1,9}$/.test(planId) || !net) {
        return fail(MSG.details, 400);
    }
    if (body.source !== 'simple') return fail('Easy Power plans cannot be purchased yet.', 400);

    const reference = 'Data_' + pickRequestId(body.request_id);

    return processPurchase(context, {
        uuid: uuid,
        pin: pin,
        reference: reference,
        service: 'data',
        prepare: async () => {
            const row = await firstRow(env, 'buydata');
            const plan = parseList(row ? row[netKey] : null).find((p) => String(p.plan_id) === planId);
            const price = plan ? round2(Number(plan.price)) : 0;
            if (!plan || !(price > 0)) return fail('This plan is no longer available.', 400);

            let cost = await liveCost(env, net.name, planId);
            if (cost === null) cost = await storedCost(env, netKey, planId);
            if (cost !== null && price < cost) return fail('This plan is temporarily unavailable. Please try again later.', 400);

            return {
                total: price,
                cost: cost,
                tx: { type: 'data purchase', title: net.name + ' ' + plan.plan_name + ' to ' + phone },
                path: '/api/data',
                payload: { network: net.id, phone: phone, data_plan: Number(planId), bypass: false },
                success: () => ({ body: { message: plan.plan_name + ' has been sent to ' + phone + '.' } })
            };
        }
    });
}
