import { json, dbClient, authUser, sha256, newApiKey, newApiId } from '../_lib/core.js';

export async function onRequestPost({ request, env }) {
    const db = dbClient(env);
    const user = await authUser(request, db);
    if (!user) return json({ success: false, message: 'Please sign in first.' }, 401);

    let body;
    try {
        body = await request.json();
    } catch (err) {
        return json({ success: false, message: 'Invalid request.' }, 400);
    }

    try {
        const rows = await db.sb('api_resellers?id=eq.' + user.id + '&select=*');
        const me = rows && rows[0] ? rows[0] : null;

        if (body.action === 'register') {
            if (me) return json({ success: false, message: 'You already have an API account.' }, 409);
            const businessName = String(body.business_name || '').trim();
            const phone = String(body.phone || '').trim();
            if (businessName.length < 2 || businessName.length > 60 || !/^0\d{10}$/.test(phone)) {
                return json({ success: false, message: 'Please enter a valid business name and an 11-digit phone number.' }, 400);
            }
            const apiKey = newApiKey();
            const keyHash = await sha256(apiKey);
            let created = null;
            for (let attempt = 0; attempt < 4 && !created; attempt++) {
                try {
                    const inserted = await db.sb('api_resellers', {
                        method: 'POST',
                        body: JSON.stringify({
                            id: user.id,
                            api_id: newApiId(),
                            business_name: businessName,
                            phone: phone,
                            email: user.email,
                            key_hash: keyHash,
                            key_prefix: apiKey.slice(0, 8)
                        })
                    });
                    created = inserted && inserted[0] ? inserted[0] : null;
                } catch (err) {
                    created = null;
                }
            }
            if (!created) return json({ success: false, message: 'Could not create your account. Please try again.' }, 500);
            return json({ success: true, message: 'Your API account has been created.', api_id: created.api_id, api_key: apiKey });
        }

        if (!me) return json({ success: false, message: 'No API account found for this login.', needs_register: true }, 404);

        if (body.action === 'dashboard') {
            const orders = await db.sb('sim_orders?reseller_id=eq.' + user.id +
                '&select=reference,network,phone,plan_name,price,status,created_at&order=created_at.desc&limit=20');
            return json({
                success: true,
                account: {
                    api_id: me.api_id,
                    business_name: me.business_name,
                    phone: me.phone,
                    email: me.email,
                    balance: Number(me.balance),
                    held: Number(me.held),
                    key_prefix: me.key_prefix,
                    status: me.status,
                    created_at: me.created_at
                },
                orders: orders || []
            });
        }

        if (body.action === 'rotate_key') {
            const apiKey = newApiKey();
            await db.sb('api_resellers?id=eq.' + user.id, {
                method: 'PATCH',
                prefer: 'return=minimal',
                body: JSON.stringify({ key_hash: await sha256(apiKey), key_prefix: apiKey.slice(0, 8) })
            });
            return json({ success: true, message: 'A new API key has been created. The old key no longer works.', api_key: apiKey });
        }

        return json({ success: false, message: 'Invalid request.' }, 400);
    } catch (err) {
        return json({ success: false, message: 'Something went wrong. Please try again.' }, 500);
    }
}