const PROVIDERS = {
    DSTV: { id: 2, live: 'DSTV', match: 'DSTV', name: 'DSTV' },
    GOTV: { id: 1, live: 'GOTV', match: 'GOTV', name: 'GOTV' },
    STARTIMES: { id: 3, live: 'STARTIME', match: 'STARTIME', name: 'STARTIMES' }
};

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
    const pin = String(body.pin || '');
    const iuc = String(body.iuc || '').trim();
    const phone = String(body.phone || '').trim();
    const planId = String(body.plan_id || '');
    const prov = PROVIDERS[String(body.provider || '')];

    if (!/^[0-9a-fA-F-]{36}$/.test(uuid) || !/^\d{4}$/.test(pin) || !/^\d{10}$/.test(iuc) || !planId || !prov ||
        (phone && !/^(0\d{10}|234\d{10})$/.test(phone))) {
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

        const rows = await sb('cabletv?select=*&limit=1');
        let list = rows && rows[0] ? rows[0].alltv_plan : [];
        if (typeof list === 'string') list = JSON.parse(list);
        const plan = Array.isArray(list)
            ? list.find((p) => String(p.plan_id) === planId && String(p.cable_name || '').toUpperCase().indexOf(prov.match) === 0)
            : null;
        const price = plan ? Number(plan.price) : 0;
        if (!plan || !(price > 0)) return json({ success: false, message: 'This package is no longer available.' }, 400);

        let cost = null;
        try {
            const costRes = await fetch('https://bilalsadasub.com/api/v1/plans/cable?cable=' + prov.live);
            const costJson = await costRes.json();
            const found = costJson && Array.isArray(costJson.data) ? costJson.data.find((p) => String(p.plan_id) === planId) : null;
            if (found) cost = Number(found.plan_price);
        } catch (err) {
            cost = null;
        }
        if (cost !== null && price < cost) {
            return json({ success: false, message: 'This package is temporarily unavailable. Please try again later.' }, 400);
        }

        const balance = parseFloat(String(ud.user_balance || 0).replace(/,/g, '')) || 0;
        if (balance < price) return json({ success: false, message: 'Your wallet balance is not enough. Please fund your wallet.' }, 400);

        const reference = 'Cable_' + Date.now() + Math.floor(Math.random() * 1000);
        const title = prov.name + ' ' + plan.plan_name + ' for ' + iuc;
        const makeTx = (status) => ({
            type: 'tv subscription',
            direction: 'out',
            title: title,
            amount: price,
            status: status,
            reference: reference,
            created_at: new Date().toISOString()
        });

        await apply(-price, null);

        let result = null;
        let unknown = false;
        try {
            const payload = { cable: prov.id, iuc: iuc, plan_id: Number(planId), 'request-id': reference };
            if (phone) payload.phone = phone;
            const res = await fetch('https://bilalsadasub.com/api/cable', {
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
            const next = await apply(0, makeTx('success'));
            try {
                await sb('profit_log', {
                    method: 'POST',
                    body: JSON.stringify({
                        user_id: uuid,
                        service: 'cable',
                        description: title,
                        reference: reference,
                        cost: cost === null ? 0 : cost,
                        price: price,
                        profit: cost === null ? 0 : Math.round((price - cost) * 100) / 100
                    })
                });
            } catch (err) {}
            return json({ success: true, message: plan.plan_name + ' has been renewed for ' + iuc + '.', balance: next });
        }

        await apply(price, makeTx('failed'));
        return json({ success: false, message: 'The renewal could not be completed. You have not been charged.' });
    } catch (err) {
        return json({ success: false, message: 'Something went wrong. Please try again.' }, 500);
    }
}