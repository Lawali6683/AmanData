const COLUMNS = ['wec_data', 'neco_data', 'nabteb_data', 'jamb_data'];

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost({ request, env }) {
    let body;
    try {
        body = await request.json();
    } catch (err) {
        return json({ success: false, message: 'Invalid request.' }, 400);
    }

    const uuid = String(body.uuid || '');
    if (!/^[0-9a-fA-F-]{36}$/.test(uuid)) return json({ success: false, message: 'Invalid request.' }, 400);

    async function verifyJamb(profile) {
        const form = new URLSearchParams({ profile_id: profile, token: env.BILAL_API_KEY });
        const res = await fetch('https://bilalsadasub.com/api/app/verify_jamb', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form
        });
        const data = await res.json();
        return data && data.status === 'success' && data.name ? String(data.name) : '';
    }

    if (body.action === 'verify') {
        const profile = String(body.profile_id || '');
        if (!/^\d{8,15}$/.test(profile)) return json({ success: false, message: 'Please enter a valid profile code.' }, 400);
        try {
            const name = await verifyJamb(profile);
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
    let quantity = Number(body.quantity);

    if (!/^\d{4}$/.test(pin) || !COLUMNS.includes(examKey) || !/^\d{1,3}$/.test(examId) || (phone && !/^(0\d{10}|234\d{10})$/.test(phone))) {
        return json({ success: false, message: 'Please check your details and try again.' }, 400);
    }

    const base = String(env.SUPABASE_URL).replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '') + '/rest/v1/';
    const key = env.SUPABASE_SERVICE_ROLE_KEY;

    async function sb(path, options) {
        const opts = options || {};
        const res = await fetch(base + path, {
            method: opts.method || 'GET',
            body: opts.body,
            headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
        });
        if (!res.ok) throw new Error('db ' + res.status);
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    }

    async function getUser() {
        const rows = await sb('user_profiles?id=eq.' + encodeURIComponent(uuid) + '&select=user_data');
        return rows && rows[0] ? rows[0].user_data : null;
    }

    async function apply(delta, tx) {
        const ud = await getUser();
        const current = parseFloat(String(ud.user_balance || 0).replace(/,/g, '')) || 0;
        const next = current + delta;
        if (next < 0) throw new Error('low');
        ud.user_balance = next.toFixed(2);
        if (tx) ud.transactions = [tx].concat(Array.isArray(ud.transactions) ? ud.transactions : []);
        await sb('user_profiles?id=eq.' + encodeURIComponent(uuid), { method: 'PATCH', body: JSON.stringify({ user_data: ud }) });
        return next;
    }

    try {
        const ud = await getUser();
        if (!ud) return json({ success: false, message: 'Account not found.' }, 404);
        if (String(ud.pin) !== pin) return json({ success: false, message: 'Incorrect PIN. Please try again.' }, 403);

        const rows = await sb('exampins?select=*&limit=1');
        let list = rows && rows[0] ? rows[0][examKey] : [];
        if (typeof list === 'string') list = JSON.parse(list);
        const item = Array.isArray(list) ? list.find((x) => String(x.exam_id) === examId) : null;
        const unit = item ? Number(item.price) : 0;
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
                candidate = await verifyJamb(profileCode);
            } catch (err) {
                return json({ success: false, message: 'Verification failed. Please try again.' }, 502);
            }
            if (!candidate) return json({ success: false, message: 'We could not verify this profile code. You have not been charged.' }, 400);
        }

        let liveName = String(item.exam_name || '');
        let unitCost = null;
        try {
            const costRes = await fetch('https://bilalsadasub.com/api/v1/plans/exams');
            const costJson = await costRes.json();
            const found = costJson && Array.isArray(costJson.data) ? costJson.data.find((x) => String(x.exam_id) === examId) : null;
            if (found) {
                unitCost = Number(found.amount);
                liveName = String(found.exam_name || liveName);
            }
        } catch (err) {
            unitCost = null;
        }
        if (unitCost !== null && unit < unitCost) {
            return json({ success: false, message: 'This exam pin is temporarily unavailable. Please try again later.' }, 400);
        }

        const price = Math.round(unit * quantity * 100) / 100;
        const cost = unitCost === null ? 0 : Math.round(unitCost * quantity * 100) / 100;
        const balance = parseFloat(String(ud.user_balance || 0).replace(/,/g, '')) || 0;
        if (balance < price) return json({ success: false, message: 'Your wallet balance is not enough. Please fund your wallet.' }, 400);

        const reference = 'Exam_' + Date.now() + Math.floor(Math.random() * 1000);
        const title = liveName + (quantity > 1 ? ' x' + quantity : '') + (candidate ? ' for ' + candidate : '');
        const makeTx = (status, extra) => Object.assign({
            type: 'exam pin',
            direction: 'out',
            title: title,
            amount: price,
            status: status,
            reference: reference,
            created_at: new Date().toISOString()
        }, extra || {});

        await apply(-price, null);

        const payload = { exam_id: Number(examId), 'request-id': reference };
        if (phone) payload.phone = phone;
        if (profileMode) {
            payload.profile_code = profileCode;
            payload.jamb_type = /MOCK/i.test(liveName) ? 'MOCK' : (/DIRECT|DE/i.test(liveName) ? 'DE' : 'UTME');
        } else {
            payload.quantity = quantity;
        }

        let result = null;
        let unknown = false;
        try {
            const res = await fetch('https://bilalsadasub.com/api/exam', {
                method: 'POST',
                headers: { Authorization: 'Token ' + env.BILAL_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            result = await res.json();
        } catch (err) {
            unknown = true;
        }

        if (unknown) {
            await apply(0, makeTx('pending'));
            return json({ success: false, message: 'Your request is being processed. Please check your history shortly before trying again.' });
        }

        if (result && result.status === 'success') {
            let pins = [];
            if (Array.isArray(result.pins)) pins = result.pins.map((p) => ({ pin: String(p.pin || ''), serial: String(p.serial || '') }));
            else if (result.pin) pins = [{ pin: String(result.pin), serial: '' }];
            const next = await apply(0, makeTx('success', { pins: pins }));
            try {
                await sb('profit_log', {
                    method: 'POST',
                    body: JSON.stringify({
                        user_id: uuid,
                        service: 'exam',
                        description: title,
                        reference: reference,
                        cost: cost,
                        price: price,
                        profit: unitCost === null ? 0 : Math.round((price - cost) * 100) / 100
                    })
                });
            } catch (err) {}
            return json({ success: true, message: liveName + (quantity > 1 ? ' pins were' : ' pin was') + ' purchased successfully.', pins: pins, balance: next });
        }

        await apply(price, makeTx('failed'));
        return json({ success: false, message: 'The purchase could not be completed. You have not been charged.' });
    } catch (err) {
        return json({ success: false, message: 'Something went wrong. Please try again.' }, 500);
    }
}