import { MSG, fail, isUuid, readBody, pickRequestId, pick, pricingRule, serviceCharge, providerCost, round2, processPurchase } from './walletcore.js';

const NETWORKS = {
    mtn: { id: 1, name: 'MTN' },
    airtel: { id: 2, name: 'AIRTEL' },
    glo: { id: 3, name: 'GLO' },
    '9mobile': { id: 4, name: '9MOBILE' }
};

export async function onRequestPost(context) {
    const { request, env } = context;

    const body = await readBody(request);
    if (!body) return fail(MSG.invalid, 400);

    const uuid = String(body.uuid || '');
    const pin = String(body.pin || '');
    const phone = String(body.phone || '').trim();
    const amount = Number(body.amount);
    const netKey = String(body.network || '');
    const net = pick(NETWORKS, netKey);

    if (!isUuid(uuid) || !/^\d{4}$/.test(pin) || !/^(0\d{10}|234\d{10})$/.test(phone) || !net ||
        !Number.isInteger(amount) || amount < 50 || amount > 50000) {
        return fail(MSG.details, 400);
    }

    const reference = 'AT_' + pickRequestId(body.request_id);

    return processPurchase(context, {
        uuid: uuid,
        pin: pin,
        reference: reference,
        service: 'airtime',
        prepare: async () => {
            const rule = await pricingRule(env, 'airtime', netKey);
            if (!rule.enabled) return fail('This network is not available right now. Please try again later.', 400);

            const fee = serviceCharge(rule, amount);
            const total = round2(amount + fee);

            return {
                total: total,
                cost: (outcome) => providerCost(outcome, amount),
                tx: { type: 'airtime purchase', title: net.name + ' airtime to ' + phone, amount: total, face_amount: amount, fee: fee },
                path: '/api/topup',
                payload: { network: net.id, phone: phone, amount: amount, plan_type: 'VTU' },
                success: () => ({ body: { message: '₦' + amount + ' ' + net.name + ' airtime has been sent to ' + phone + '.' } })
            };
        }
    });
}
