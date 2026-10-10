function json(body, status) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ success: false, message: 'Sign in required.' }, 401);

    const base = String(env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
    const headers = { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

    try {
        const user = await fetch(base + '/auth/v1/user', { headers: headers });
        if (!user.ok) return json({ success: false, message: 'Session expired.' }, 401);

        const check = await fetch(base + '/rest/v1/rpc/is_admin_user', { method: 'POST', headers: headers, body: '{}' });
        const allowed = check.ok && (await check.json()) === true;
        if (!allowed) return json({ success: false, message: 'Access denied.' }, 403);

        return json({ success: true, url: env.PARTNER_URL || 'https://app.bilalsadasub.com/dashboard/app' }, 200);
    } catch (err) {
        return json({ success: false, message: 'Could not create the link.' }, 500);
    }
}
