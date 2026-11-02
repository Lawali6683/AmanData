import { MSG, fail, isUuid, readBody, pickRequestId, pricingRule, serviceCharge, providerCost, round2, processPurchase, PROVIDER } from './walletcore.js';

async function liveDiscos(env) {
    const res = await fetch(PROVIDER + '/api/v1/plans/discos', {
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + env.BILAL_API_KEY, 'X-API-Key': env.BILAL_API_KEY },
        signal: AbortSignal.timeout(12000)
    });
    const data = await res.json();
    if (!data || !Array.isArray(data.data)) throw new Error('bad discos response');
    return data.data.map((d) => ({ plan_id: String(d.plan_id), disco_name: String(d.disco_name || '') }));
}

export async function onRequestPost(context) {
    const { request, env } = context;

    const body = await readBody(request);
    if (!body) return fail(MSG.invalid, 400);

    const uuid = String(body.uuid || '');
    const pin = String(body.pin || '');
    const discoId = String(body.disco || '');
    const meterType = String(body.meter_type || '');
    const meter = String(body.meter || '').trim();
    const phone = String(body.phone || '').trim();
    const amount = Number(body.amount);

    if (!isUuid(uuid) || !/^\d{4}$/.test(pin) || !/^\d{1,3}$/.test(discoId) ||
        (meterType !== 'prepaid' && meterType !== 'postpaid') || !/^\d{6,20}$/.test(meter) ||
        (phone && !/^(0\d{10}|234\d{10})$/.test(phone)) || !Number.isInteger(amount) || amount < 500 || amount > 500000) {
        return fail(MSG.details, 400);
    }

    const reference = 'Bill_' + pickRequestId(body.request_id);

    return processPurchase(context, {
        uuid: uuid,
        pin: pin,
        reference: reference,
        service: 'electricity',
        prepare: async () => {
            let discoName = '';
            try {
                const found = (await liveDiscos(env)).find((d) => d.plan_id === discoId);
                if (!found) return fail('This electricity company is not available.', 400);
                discoName = found.disco_name;
            } catch (err) {
                return fail(MSG.network, 502);
            }

            const rule = await pricingRule(env, 'electricity', discoId);
            if (!rule.enabled) return fail('This electricity company is not available right now. Please try again later.', 400);

            const fee = serviceCharge(rule, amount);
            const total = round2(amount + fee);
            const title = discoName + ' ' + meterType + ' ' + meter;

            const payload = { disco: Number(discoId), meter_type: meterType, meter: meter, amount: amount };
            if (phone) payload.phone = phone;

            return {
                total: total,
                cost: (outcome) => providerCost(outcome, amount),
                tx: { type: 'electricity bill', title: title, amount: total, face_amount: amount, fee: fee },
                path: '/api/bill',
                payload: payload,
                success: (outcome) => {
                    const result = outcome.data || {};
                    const token = result.token ? String(result.token) : '';
                    const units = result.units ? String(result.units) : '';
                    return {
                        extra: token ? { token: token, units: units } : {},
                        body: {
                            message: '₦' + amount + ' ' + discoName + ' payment was successful for meter ' + meter + '.',
                            token: token,
                            units: units,
                            amount: amount
                        }
                    };
                }
            };
        }
    });
}
