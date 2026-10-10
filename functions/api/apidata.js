const API = 'https://bilalsadasub.com/api/v1/plans/';

const examGroup = (name) => {
    const n = String(name || '').toUpperCase();
    if (n.indexOf('WAEC') === 0) return 'wec_data';
    if (n.indexOf('NECO') === 0) return 'neco_data';
    if (n.indexOf('NABTEB') === 0) return 'nabteb_data';
    return 'jamb_data';
};

const SERVICES = {
    data: {
        table: 'buydata',
        raw: 'aipbuydata',
        groups: [
            { key: 'mtn_plan', label: 'MTN', live: 'MTN' },
            { key: 'itel_data', label: 'AIRTEL', live: 'AIRTEL' },
            { key: 'glo_data', label: 'GLO', live: 'GLO' },
            { key: '9mobile_data', label: '9MOBILE', live: 'T2' }
        ],
        column: (g) => g,
        uidOf: (e) => String(e.plan_id),
        savedFor: (row, g, parse) => parse(row[g]),
        fetchGroup: async (g, get) => (await get('data?network=' + g.live)).map((p) => ({
            uid: String(p.plan_id),
            name: p.plan_name,
            sub: [p.plan_type, p.plan_day].filter(Boolean).join(' • '),
            cost: Number(p.amount),
            entry: { plan_id: String(p.plan_id), plan_name: p.plan_name, plan_type: p.plan_type, plan_day: p.plan_day }
        }))
    },
    cable: {
        table: 'cabletv',
        raw: 'apicabletv',
        groups: [
            { key: 'DSTV', label: 'DSTV', live: 'DSTV' },
            { key: 'GOTV', label: 'GOTV', live: 'GOTV' },
            { key: 'STARTIME', label: 'STARTIMES', live: 'STARTIME' }
        ],
        column: () => 'alltv_plan',
        uidOf: (e) => String(e.cable_name) + ':' + String(e.plan_id),
        savedFor: (row, g, parse) => parse(row.alltv_plan).filter((e) => e.cable_name === g),
        fetchGroup: async (g, get) => (await get('cable?cable=' + g.live)).map((p) => ({
            uid: g.key + ':' + String(p.plan_id),
            name: p.plan_name,
            sub: g.label,
            cost: Number(p.plan_price),
            entry: { plan_id: String(p.plan_id), cable_name: g.key, plan_name: p.plan_name }
        }))
    },
    exam: {
        table: 'exampins',
        raw: 'apiexampins',
        groups: [
            { key: 'wec_data', label: 'WAEC' },
            { key: 'neco_data', label: 'NECO' },
            { key: 'nabteb_data', label: 'NABTEB' },
            { key: 'jamb_data', label: 'JAMB' }
        ],
        column: (g) => g,
        uidOf: (e) => String(e.exam_id),
        savedFor: (row, g, parse) => parse(row[g]),
        fetchGroup: async (g, get) => (await get('exams')).filter((p) => examGroup(p.exam_name) === g.key).map((p) => ({
            uid: String(p.exam_id),
            name: p.exam_name,
            sub: p.mode === 'profile_code' ? 'Profile code' : 'Quantity',
            cost: Number(p.amount),
            entry: { exam_id: String(p.exam_id), exam_name: p.exam_name, mode: p.mode }
        }))
    }
};

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });

const round2 = (n) => Math.round(n * 100) / 100;
const parseList = (v) => {
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (err) { v = []; } }
    return Array.isArray(v) ? v : [];
};

async function checkAdmin(root, key, token) {
    let res;
    try {
        res = await fetch(root + '/rest/v1/rpc/is_admin_user', {
            method: 'POST',
            headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: '{}'
        });
    } catch (err) {
        return { status: 500, message: 'Could not verify your access. Please try again.' };
    }
    if (res.status === 401) return { status: 401, message: 'Your session has expired. Please sign in again.' };
    if (!res.ok) return { status: 500, message: 'Could not verify your access. Check that is_admin_user() exists in Supabase.' };
    let allowed = false;
    try { allowed = (await res.json()) === true; } catch (err) { allowed = false; }
    if (!allowed) return { status: 403, message: 'You do not have access to this page.' };
    return null;
}

export async function onRequestPost({ request, env }) {
    const root = String(env.SUPABASE_URL).replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
    const key = env.SUPABASE_SERVICE_ROLE_KEY;

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ success: false, message: 'Please sign in first.' }, 401);

    const denied = await checkAdmin(root, key, token);
    if (denied) return json({ success: false, message: denied.message }, denied.status);

    let body;
    try {
        body = await request.json();
    } catch (err) {
        return json({ success: false, message: 'Invalid request.' }, 400);
    }

    const svc = SERVICES[String(body.service || '')];
    if (!svc) return json({ success: false, message: 'Invalid request.' }, 400);

    const memo = {};
    const get = (path) => {
        if (!memo[path]) {
            memo[path] = fetch(API + path).then((r) => r.json()).then((d) => {
                if (!d || !Array.isArray(d.data)) throw new Error('bad');
                return d.data;
            });
        }
        return memo[path];
    };

    async function sb(path, options) {
        const opts = options || {};
        const res = await fetch(root + '/rest/v1/' + path, {
            method: opts.method || 'GET',
            body: opts.body,
            headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
        });
        if (!res.ok) throw new Error('db ' + res.status);
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    }

    async function saveRow(table, patch) {
        const rows = await sb(table + '?select=id&limit=1');
        if (rows && rows[0]) {
            await sb(table + '?id=eq.' + encodeURIComponent(rows[0].id), { method: 'PATCH', body: JSON.stringify(patch) });
        } else {
            await sb(table, { method: 'POST', body: JSON.stringify(Object.assign({ id: 'main' }, patch)) });
        }
    }

    const rawOf = (it) => Object.assign({}, it.entry, { amount: it.cost });

    try {
        if (body.action === 'load') {
            const results = await Promise.all(svc.groups.map((g) => svc.fetchGroup(g, get).catch(() => null)));
            if (results.every((r) => r === null)) return json({ success: false, message: 'Could not reach the provider. Please try again.' }, 502);

            const patch = {};
            if (svc === SERVICES.cable) {
                if (results.every((r) => r !== null)) patch.alltv_plan = [].concat.apply([], results).map(rawOf);
            } else {
                svc.groups.forEach((g, i) => { if (results[i]) patch[svc.column(g.key)] = results[i].map(rawOf); });
            }
            if (Object.keys(patch).length) await saveRow(svc.raw, patch);

            const rows = await sb(svc.table + '?select=*&limit=1');
            const row = rows && rows[0] ? rows[0] : {};
            const live = {};
            const saved = {};
            svc.groups.forEach((g, i) => {
                live[g.key] = (results[i] || []).map((it) => ({ uid: it.uid, name: it.name, sub: it.sub, cost: it.cost }));
                saved[g.key] = {};
                svc.savedFor(row, g.key, parseList).forEach((e) => { saved[g.key][svc.uidOf(e)] = Number(e.price); });
            });
            return json({ success: true, groups: svc.groups.map((g) => ({ key: g.key, label: g.label })), live: live, saved: saved });
        }

        if (body.action === 'save') {
            const group = svc.groups.find((g) => g.key === String(body.group || ''));
            const items = Array.isArray(body.items) ? body.items : [];
            if (!group || !items.length || items.length > 500) return json({ success: false, message: 'Invalid request.' }, 400);

            const fresh = await svc.fetchGroup(group, get);
            const col = svc.column(group.key);
            const rows = await sb(svc.table + '?select=*&limit=1');
            const list = parseList(rows && rows[0] ? rows[0][col] : []);
            const prices = {};

            for (const item of items) {
                const it = fresh.find((p) => p.uid === String(item.uid));
                const markup = Number(item.markup);
                if (!it || !isFinite(markup) || markup < 0 || markup > 100000 || !isFinite(it.cost)) continue;
                const price = round2(it.cost + markup);
                const entry = Object.assign({}, it.entry, { price: price });
                const at = list.findIndex((e) => svc.uidOf(e) === it.uid);
                if (at >= 0) list[at] = entry; else list.push(entry);
                prices[it.uid] = price;
            }

            if (!Object.keys(prices).length) return json({ success: false, message: 'No valid items to save.' }, 400);
            const patch = {};
            patch[col] = list;
            await saveRow(svc.table, patch);
            return json({ success: true, message: Object.keys(prices).length + ' price(s) saved successfully.', prices: prices });
        }

        return json({ success: false, message: 'Invalid request.' }, 400);
    } catch (err) {
        return json({ success: false, message: 'Something went wrong. Please try again.' }, 500);
    }
}
