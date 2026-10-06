const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });

const HOUR = 3600000;
const pad = (n) => String(n).padStart(2, '0');
const round2 = (n) => Math.round(n * 100) / 100;

export async function onRequestPost({ request, env }) {
    const root = String(env.SUPABASE_URL).replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
    const key = env.SUPABASE_SERVICE_ROLE_KEY;

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ success: false, message: 'Please sign in first.' }, 401);

    let email = '';
    try {
        const who = await fetch(root + '/auth/v1/user', { headers: { apikey: key, Authorization: 'Bearer ' + token } });
        if (who.ok) email = String((await who.json()).email || '').toLowerCase();
    } catch (err) {
        email = '';
    }
    if (!email) return json({ success: false, message: 'Your session has expired. Please sign in again.' }, 401);

    const admins = String(env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!admins.includes(email)) return json({ success: false, message: 'You do not have access to this page.' }, 403);

    let body;
    try {
        body = await request.json();
    } catch (err) {
        return json({ success: false, message: 'Invalid request.' }, 400);
    }

    const month = String(body.month || '');
    if (body.action !== 'report' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return json({ success: false, message: 'Invalid request.' }, 400);
    }

    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    const from = new Date(Date.UTC(y, m - 12, 1) - HOUR).toISOString();
    const to = new Date(Date.UTC(y, m, 1) - HOUR).toISOString();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

    try {
        const rows = [];
        for (let page = 0; page < 50; page++) {
            const path = 'profit_log?select=created_at,price,profit&created_at=gte.' + encodeURIComponent(from) +
                '&created_at=lt.' + encodeURIComponent(to) + '&order=created_at.asc&limit=1000&offset=' + page * 1000;
            const res = await fetch(root + '/rest/v1/' + path, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
            if (!res.ok) throw new Error('db');
            const chunk = await res.json();
            rows.push.apply(rows, chunk);
            if (chunk.length < 1000) break;
        }

        const days = {};
        const weeks = {};
        const months = {};
        const total = { count: 0, sales: 0, profit: 0 };
        const add = (map, k, r) => {
            const o = map[k] || (map[k] = { count: 0, sales: 0, profit: 0 });
            o.count += 1;
            o.sales += Number(r.price) || 0;
            o.profit += Number(r.profit) || 0;
        };

        rows.forEach((r) => {
            const d = new Date(new Date(r.created_at).getTime() + HOUR);
            const mk = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
            const day = d.getUTCDate();
            add(months, mk, r);
            if (mk === month) {
                add(days, mk + '-' + pad(day), r);
                add(weeks, Math.floor((day - 1) / 7) + 1, r);
                total.count += 1;
                total.sales += Number(r.price) || 0;
                total.profit += Number(r.profit) || 0;
            }
        });

        const out = (o) => ({ count: o.count, sales: round2(o.sales), profit: round2(o.profit) });

        return json({
            success: true,
            month: month,
            total: out(total),
            days: Object.keys(days).sort().map((k) => Object.assign({ date: k }, out(days[k]))),
            weeks: Object.keys(weeks).map(Number).sort((a, b) => a - b).map((w) =>
                Object.assign({ week: w, from: (w - 1) * 7 + 1, to: Math.min(w * 7, daysInMonth) }, out(weeks[w]))),
            months: Object.keys(months).sort().map((k) => Object.assign({ month: k }, out(months[k])))
        });
    } catch (err) {
        return json({ success: false, message: 'Something went wrong. Please try again.' }, 500);
    }
}