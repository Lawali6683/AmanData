const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });

async function liveDiscos() {
    const res = await fetch('https://bilalsadasub.com/api/v1/plans/discos');
    const data = await res.json();
    if (!data || !Array.isArray(data.data)) throw new Error('bad');
    return data.data.map((d) => ({ plan_id: String(d.plan_id), disco_name: d.disco_name, logo: d.logo || '' }));
}

export async function onRequestPost({ request, env }) {
    let body;
    try {
        body = await request.json();
    } catch (err) {
        return json({ success: false, message: 'Invalid request.' }, 400);
    }

    if (body.action === 'discos') {
        try {
            return json({ success: true, discos: await liveDiscos() });
        } catch (err) {
            return json({ success: false, message: 'Could not load electricity companies.' }, 502);
        }
    }

    const uuid = String(body.uuid || '');
    const pin = String(body.pin || '');
    const discoId = String(body.disco || '');
    const meterType = String(body.meter_type || '');
    const meter = String(body.meter || '').trim();
    const phone = String(body.phone || '').trim();
    const amount = Number(body.amount);

    if (!/^[0-9a-fA-F-]{36}$/.test(uuid) || !/^\d{4}$/.test(pin) || !/^\d{1,3}$/.test(discoId) ||
        (meterType !== 'prepaid' && meterType !== 'postpaid') || !/^\d{6,20}$/.test(meter) ||
        (phone && !/^(0\d{10}|234\d{10})$/.test(phone)) || !Number.isInteger(amount) || amount < 500 || amount > 500000) {
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

        let discoName = '';
        try {
            const found = (await liveDiscos()).find((d) => d.plan_id === discoId);
            if (!found) return json({ success: false, message: 'This electricity company is not available.' }, 400);
            discoName = found.disco_name;
        } catch (err) {
            return json({ success: false, message: 'Could not verify the electricity company. Please try again.' }, 502);
        }

        const balance = parseFloat(String(ud.user_balance || 0).replace(/,/g, '')) || 0;
        if (balance < amount) return json({ success: false, message: 'Your wallet balance is not enough. Please fund your wallet.' }, 400);

        const reference = 'Bill_' + Date.now() + Math.floor(Math.random() * 1000);
        const title = discoName + ' ' + meterType + ' ' + meter;
        const makeTx = (status, extra) => Object.assign({
            type: 'electricity bill',
            direction: 'out',
            title: title,
            amount: amount,
            status: status,
            reference: reference,
            created_at: new Date().toISOString()
        }, extra || {});

        await apply(-amount, null);

        let result = null;
        let unknown = false;
        try {
            const payload = { disco: Number(discoId), meter_type: meterType, meter: meter, amount: amount, 'request-id': reference };
            if (phone) payload.phone = phone;
            const res = await fetch('https://bilalsadasub.com/api/bill', {
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
            const token = result.token ? String(result.token) : '';
            const units = result.units ? String(result.units) : '';
            const next = await apply(0, makeTx('success', token ? { token: token, units: units } : {}));
            const charged = parseFloat(result.oldbal) - parseFloat(result.newbal);
            const cost = isFinite(charged) && charged > 0 ? charged : amount;
            try {
                await sb('profit_log', {
                    method: 'POST',
                    body: JSON.stringify({
                        user_id: uuid,
                        service: 'electricity',
                        description: title,
                        reference: reference,
                        cost: cost,
                        price: amount,
                        profit: Math.round((amount - cost) * 100) / 100
                    })
                });
            } catch (err) {}
            return json({
                success: true,
                message: '₦' + amount + ' ' + discoName + ' payment was successful for meter ' + meter + '.',
                token: token,
                units: units,
                amount: amount,
                balance: next
            });
        }

        await apply(amount, makeTx('failed'));
        return json({ success: false, message: 'The payment could not be completed. You have not been charged.' });
    } catch (err) {
        return json({ success: false, message: 'Something went wrong. Please try again.' }, 500);
    }
}