import { MSG, fail, isUuid, readBody, pickRequestId, pick, firstRow, parseList, positiveOrNull, round2, processPurchase, PROVIDER } from './walletcore.js';

const PROVIDERS = {
    DSTV: { id: 2, live: 'DSTV', match: 'DSTV', name: 'DSTV' },
    GOTV: { id: 1, live: 'GOTV', match: 'GOTV', name: 'GOTV' },
    STARTIMES: { id: 3, live: 'STARTIME', match: 'STARTIME', name: 'STARTIMES' }
};

async function liveCost(cable, planId) {
    try {
        const res = await fetch(PROVIDER + '/api/v1/plans/cable?cable=' + cable, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        const found = data && Array.isArray(data.data) ? data.data.find((p) => String(p.plan_id) === planId) : null;
        return found ? positiveOrNull(found.plan_price) : null;
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
    const iuc = String(body.iuc || '').trim();
    const phone = String(body.phone || '').trim();
    const planId = String(body.plan_id || '');
    const prov = pick(PROVIDERS, String(body.provider || ''));

    if (!isUuid(uuid) || !/^\d{4}$/.test(pin) || !/^\d{10}$/.test(iuc) || !/^\d{1,9}$/.test(planId) || !prov ||
        (phone && !/^(0\d{10}|234\d{10})$/.test(phone))) {
        return fail(MSG.details, 400);
    }

    const reference = 'Cable_' + pickRequestId(body.request_id);

    return processPurchase(context, {
        uuid: uuid,
        pin: pin,
        reference: reference,
        service: 'cable',
        prepare: async () => {
            const row = await firstRow(env, 'cabletv');
            const plan = parseList(row ? row.alltv_plan : null).find(
                (p) => String(p.plan_id) === planId && String(p.cable_name || '').toUpperCase().indexOf(prov.match) === 0
            );
            const price = plan ? round2(Number(plan.price)) : 0;
            if (!plan || !(price > 0)) return fail('This package is no longer available.', 400);

            const cost = await liveCost(prov.live, planId);
            if (cost !== null && price < cost) return fail('This package is temporarily unavailable. Please try again later.', 400);

            const payload = { cable: prov.id, iuc: iuc, plan_id: Number(planId) };
            if (phone) payload.phone = phone;

            return {
                total: price,
                cost: cost,
                tx: { type: 'tv subscription', title: prov.name + ' ' + plan.plan_name + ' for ' + iuc },
                path: '/api/cable',
                payload: payload,
                failed: 'The renewal could not be completed. You have not been charged.',
                success: () => ({ body: { message: plan.plan_name + ' has been renewed for ' + iuc + '.' } })
            };
        }
    });
}
