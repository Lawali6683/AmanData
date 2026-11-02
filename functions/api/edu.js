import { MSG, fail, json, isUuid, readBody, pickRequestId, firstRow, parseList, positiveOrNull, round2, processPurchase, PROVIDER } from './walletcore.js';

const COLUMNS = ['wec_data', 'neco_data', 'nabteb_data', 'jamb_data'];

async function verifyJamb(env, profile) {
    const form = new URLSearchParams({ profile_id: profile, token: env.BILAL_API_KEY });
    const res = await fetch(PROVIDER + '/api/app/verify_jamb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(15000)
    });
    const data = await res.json();
    return data && data.status === 'success' && data.name ? String(data.name) : '';
}

async function liveExam(examId) {
    try {
        const res = await fetch(PROVIDER + '/api/v1/plans/exams', { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        const found = data && Array.isArray(data.data) ? data.data.find((x) => String(x.exam_id) === examId) : null;
        return found ? { cost: positiveOrNull(found.amount), name: String(found.exam_name || '') } : null;
    } catch (err) {
        return null;
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;

    const body = await readBody(request);
    if (!body) return fail(MSG.invalid, 400);

    const uuid = String(body.uuid || '');
    if (!isUuid(uuid)) return fail(MSG.invalid, 400);

    if (body.action === 'verify') {
        const profile = String(body.profile_id || '');
        if (!/^\d{8,15}$/.test(profile)) return fail('Please enter a valid profile code.', 400);
        if (!env.BILAL_API_KEY) return fail(MSG.server, 500);
        try {
            const name = await verifyJamb(env, profile);
            if (!name) return fail('We could not find a candidate with this profile code.', 200);
            return json({ success: true, name: name });
        } catch (err) {
            return fail('Verification failed. Please try again.', 502);
        }
    }

    const pin = String(body.pin || '');
    const phone = String(body.phone || '').trim();
    const examKey = String(body.exam_key || '');
    const examId = String(body.exam_id || '');
    const profileCode = String(body.profile_code || '');
    const requestedQuantity = Number(body.quantity);

    if (!/^\d{4}$/.test(pin) || !COLUMNS.includes(examKey) || !/^\d{1,3}$/.test(examId) || (phone && !/^(0\d{10}|234\d{10})$/.test(phone))) {
        return fail(MSG.details, 400);
    }

    const reference = 'Exam_' + pickRequestId(body.request_id);

    return processPurchase(context, {
        uuid: uuid,
        pin: pin,
        reference: reference,
        service: 'exam',
        prepare: async () => {
            const row = await firstRow(env, 'exampins');
            const item = parseList(row ? row[examKey] : null).find((x) => String(x.exam_id) === examId);
            const unit = item ? Number(item.price) : 0;
            if (!item || !(unit > 0)) return fail('This exam pin is no longer available.', 400);

            const profileMode = item.mode === 'profile_code';
            let quantity = requestedQuantity;
            if (profileMode) {
                if (!/^\d{10}$/.test(profileCode)) return fail('Please enter a valid 10-digit profile code.', 400);
                quantity = 1;
            } else if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
                return fail('Quantity must be between 1 and 10.', 400);
            }

            let candidate = '';
            if (profileMode) {
                try {
                    candidate = await verifyJamb(env, profileCode);
                } catch (err) {
                    return fail('Verification failed. Please try again.', 502);
                }
                if (!candidate) return fail('We could not verify this profile code. You have not been charged.', 400);
            }

            const live = await liveExam(examId);
            const liveName = live && live.name ? live.name : String(item.exam_name || '');
            const unitCost = live ? live.cost : null;
            if (unitCost !== null && unit < unitCost) return fail('This exam pin is temporarily unavailable. Please try again later.', 400);

            const price = round2(unit * quantity);
            const cost = unitCost === null ? null : round2(unitCost * quantity);
            const title = liveName + (quantity > 1 ? ' x' + quantity : '') + (candidate ? ' for ' + candidate : '');

            const payload = { exam_id: Number(examId) };
            if (phone) payload.phone = phone;
            if (profileMode) {
                payload.profile_code = profileCode;
                payload.jamb_type = /MOCK/i.test(liveName) ? 'MOCK' : /DIRECT|\bDE\b/i.test(liveName) ? 'DE' : 'UTME';
            } else {
                payload.quantity = quantity;
            }

            return {
                total: price,
                cost: cost,
                tx: { type: 'exam pin', title: title },
                path: '/api/exam',
                payload: payload,
                success: (outcome) => {
                    const result = outcome.data || {};
                    let pins = [];
                    if (Array.isArray(result.pins)) pins = result.pins.map((p) => ({ pin: String((p && p.pin) || ''), serial: String((p && p.serial) || '') }));
                    else if (result.pin) pins = [{ pin: String(result.pin), serial: '' }];
                    return {
                        extra: { pins: pins },
                        body: { message: liveName + (quantity > 1 ? ' pins were' : ' pin was') + ' purchased successfully.', pins: pins }
                    };
                }
            };
        }
    });
}
