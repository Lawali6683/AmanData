const NETWORKS = {
    mtn: { id: 1, name: 'MTN' },
    airtel: { id: 2, name: 'AIRTEL' },
    glo: { id: 3, name: 'GLO' },
    '9mobile': { id: 4, name: '9MOBILE' }
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
    const phone = String(body.phone || '').trim();
    const amount = Number(body.amount);
    const net = NETWORKS[String(body.network || '')];

    if (!/^[0-9a-fA-F-]{36}$/.test(uuid) || !/^\d{4}$/.test(pin) || !/^(0\d{10}|234\d{10})$/.test(phone) || !net ||
        !Number.isInteger(amount) || amount < 50 || amount > 50000) {
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

        const balance = parseFloat(String(ud.user_balance || 0).replace(/,/g, '')) || 0;
        if (balance < amount) return json({ success: false, message: 'Your wallet balance is not enough. Please fund your wallet.' }, 400);

        const reference = 'AT_' + Date.now() + Math.floor(Math.random() * 1000);
        const title = net.name + ' airtime to ' + phone;
        const makeTx = (status) => ({
            type: 'airtime purchase',
            direction: 'out',
            title: title,
            amount: amount,
            status: status,
            reference: reference,
            created_at: new Date().toISOString()
        });

        await apply(-amount, null);

        let result = null;
        let unknown = false;
        try {
            const res = await fetch('https://bilalsadasub.com/api/topup', {
                method: 'POST',
                headers: { Authorization: 'Token ' + env.BILAL_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ network: net.id, phone: phone, amount: amount, plan_type: 'VTU', 'request-id': reference })
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
            const charged = parseFloat(result.oldbal) - parseFloat(result.newbal);
            const cost = isFinite(charged) && charged > 0 ? charged : amount;
            try {
                await sb('profit_log', {
                    method: 'POST',
                    body: JSON.stringify({
                        user_id: uuid,
                        service: 'airtime',
                        description: title,
                        reference: reference,
                        cost: cost,
                        price: amount,
                        profit: Math.round((amount - cost) * 100) / 100
                    })
                });
            } catch (err) {}
            return json({ success: true, message: '₦' + amount + ' ' + net.name + ' airtime has been sent to ' + phone + '.', balance: next });
        }

        await apply(amount, makeTx('failed'));
        return json({ success: false, message: 'The purchase could not be completed. You have not been charged.' });
    } catch (err) {
        return json({ success: false, message: 'Something went wrong. Please try again.' }, 500);
    }
}