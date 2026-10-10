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

class AppError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status || 500;
    }
}

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });

const round2 = (n) => Math.round(n * 100) / 100;
const snippet = (text) => String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').slice(0, 300);
const cleanRoot = (url) => String(url || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const hostOf = (url) => {
    try { return new URL(url).host; } catch (err) { return 'not set'; }
};
const parseList = (v) => {
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (err) { v = []; } }
    return Array.isArray(v) ? v : [];
};

const pickList = (data) => {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    if (data && Array.isArray(data.plans)) return data.plans;
    if (data && Array.isArray(data.result)) return data.result;
    return null;
};

const bilalHeaders = (env) => {
    const headers = { Accept: 'application/json' };
    if (env.BILAL_API_KEY) {
        headers.Authorization = 'Bearer ' + env.BILAL_API_KEY;
        headers['X-API-Key'] = env.BILAL_API_KEY;
    }
    return headers;
};

async function bilalFetch(env, path) {
    let res;
    try {
        res = await fetch(API + path, { headers: bilalHeaders(env) });
    } catch (err) {
        throw new AppError('Could not connect to Bilal (' + path + '): ' + snippet(err && err.message), 502);
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (err) { data = null; }
    return { res: res, text: text, data: data };
}

async function bilalGet(env, path) {
    const r = await bilalFetch(env, path);
    if (!r.res.ok) throw new AppError('Bilal returned ' + r.res.status + ' for ' + path + ': ' + snippet(r.text), 502);
    const list = pickList(r.data);
    if (!list) throw new AppError('Bilal sent an unexpected format for ' + path + ': ' + snippet(r.text), 502);
    return list;
}

async function bilalProbe(env, path) {
    try {
        const r = await bilalFetch(env, path);
        const list = pickList(r.data);
        return {
            path: path,
            status: r.res.status,
            ok: r.res.ok,
            json: r.data !== null,
            count: list ? list.length : null,
            sampleKeys: list && list[0] && typeof list[0] === 'object' ? Object.keys(list[0]) : null,
            sample: list && list[0] ? list[0] : null,
            body: list ? undefined : snippet(r.text)
        };
    } catch (err) {
        return { path: path, ok: false, error: err.message };
    }
}

async function checkAdmin(root, key, token) {
    let res;
    try {
        res = await fetch(root + '/rest/v1/rpc/is_admin_user', {
            method: 'POST',
            headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: '{}'
        });
    } catch (err) {
        return { status: 500, message: 'Could not reach Supabase to verify your access: ' + snippet(err && err.message) };
    }
    if (res.status === 401) {
        return { status: 401, message: 'Supabase rejected your session. Sign in again. If this keeps happening, the app login and this API may use different Supabase projects: set AUTH_SUPABASE_URL and AUTH_SUPABASE_KEY.' };
    }
    if (!res.ok) {
        return { status: 500, message: 'Access check failed (' + res.status + '): ' + snippet(await res.text()) };
    }
    let allowed = false;
    try { allowed = (await res.json()) === true; } catch (err) { allowed = false; }
    if (!allowed) return { status: 403, message: 'You do not have access to this page.' };
    return null;
}

export async function onRequestPost({ request, env }) {
    const root = cleanRoot(env.SUPABASE_URL);
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const authRoot = cleanRoot(env.AUTH_SUPABASE_URL || env.SUPABASE_URL);
    const authKey = env.AUTH_SUPABASE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

    if (!root || !key) {
        return json({ success: false, message: 'Server setup is incomplete: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in Cloudflare.' }, 500);
    }

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ success: false, message: 'Please sign in first.' }, 401);

    const denied = await checkAdmin(authRoot, authKey, token);
    if (denied) return json({ success: false, message: denied.message }, denied.status);

    let body;
    try {
        body = await request.json();
    } catch (err) {
        return json({ success: false, message: 'Invalid request.' }, 400);
    }

    async function sb(path, options) {
        const opts = options || {};
        let res;
        try {
            res = await fetch(root + '/rest/v1/' + path, {
                method: opts.method || 'GET',
                body: opts.body,
                headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' }
            });
        } catch (err) {
            throw new AppError('Could not reach the database: ' + snippet(err && err.message), 502);
        }
        const text = await res.text();
        if (!res.ok) throw new AppError('Database ' + res.status + ' on ' + path.split('?')[0] + ': ' + snippet(text), 500);
        return text ? JSON.parse(text) : null;
    }

    if (body.action === 'diagnose') {
        const names = ['buydata', 'aipbuydata', 'apibuydata', 'cabletv', 'apicabletv', 'exampins', 'apiexampins'];
        const tables = {};
        for (const name of names) {
            try {
                const res = await fetch(root + '/rest/v1/' + name + '?select=*&limit=1', { headers: { apikey: key, Authorization: 'Bearer ' + key } });
                const text = await res.text();
                tables[name] = res.ok ? 'ok' : res.status + ': ' + snippet(text);
            } catch (err) {
                tables[name] = 'unreachable: ' + snippet(err && err.message);
            }
        }
        const bilal = {
            data_mtn: await bilalProbe(env, 'data?network=MTN'),
            cable_dstv: await bilalProbe(env, 'cable?cable=DSTV'),
            exams: await bilalProbe(env, 'exams')
        };
        return json({
            success: true,
            env: {
                SUPABASE_URL: hostOf(root),
                SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
                AUTH_PROJECT: hostOf(authRoot),
                BILAL_API_KEY: Boolean(env.BILAL_API_KEY)
            },
            tables: tables,
            bilal: bilal
        });
    }

    const svc = SERVICES[String(body.service || '')];
    if (!svc) return json({ success: false, message: 'Invalid request.' }, 400);

    const memo = {};
    const get = (path) => {
        if (!memo[path]) memo[path] = bilalGet(env, path);
        return memo[path];
    };
    const fetchGroup = async (g) => (await svc.fetchGroup(g, get)).filter((it) => isFinite(it.cost));

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
            const errors = [];
            const results = await Promise.all(svc.groups.map((g) => fetchGroup(g).catch((err) => {
                errors.push(g.label + ': ' + err.message);
                return null;
            })));
            if (results.every((r) => r === null)) {
                return json({ success: false, message: 'Could not load plans from the provider. ' + errors.slice(0, 2).join(' | ') }, 502);
            }

            let warning = errors.length ? 'Some groups failed. ' + errors.join(' | ') : '';
            const patch = {};
            if (svc === SERVICES.cable) {
                if (results.every((r) => r !== null)) patch.alltv_plan = [].concat.apply([], results).map(rawOf);
            } else {
                svc.groups.forEach((g, i) => { if (results[i]) patch[svc.column(g.key)] = results[i].map(rawOf); });
            }
            if (Object.keys(patch).length) {
                try {
                    await saveRow(svc.raw, patch);
                } catch (err) {
                    warning += ' Could not update the ' + svc.raw + ' table: ' + err.message;
                }
            }

            const rows = await sb(svc.table + '?select=*&limit=1');
            const row = rows && rows[0] ? rows[0] : {};
            const live = {};
            const saved = {};
            svc.groups.forEach((g, i) => {
                live[g.key] = (results[i] || []).map((it) => ({ uid: it.uid, name: it.name, sub: it.sub, cost: it.cost }));
                saved[g.key] = {};
                svc.savedFor(row, g.key, parseList).forEach((e) => { saved[g.key][svc.uidOf(e)] = Number(e.price); });
            });
            return json({ success: true, groups: svc.groups.map((g) => ({ key: g.key, label: g.label })), live: live, saved: saved, warning: warning.trim() || undefined });
        }

        if (body.action === 'save') {
            const group = svc.groups.find((g) => g.key === String(body.group || ''));
            const items = Array.isArray(body.items) ? body.items : [];
            if (!group || !items.length || items.length > 500) return json({ success: false, message: 'Invalid request.' }, 400);

            const fresh = await fetchGroup(group);
            const col = svc.column(group.key);
            const rows = await sb(svc.table + '?select=*&limit=1');
            const list = parseList(rows && rows[0] ? rows[0][col] : []);
            const prices = {};

            for (const item of items) {
                const it = fresh.find((p) => p.uid === String(item.uid));
                const markup = Number(item.markup);
                if (!it || !isFinite(markup) || markup < 0 || markup > 100000) continue;
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
        const status = err && err.status ? err.status : 500;
        const message = err instanceof AppError ? err.message : 'Something went wrong: ' + snippet(err && err.message);
        return json({ success: false, message: message }, status);
    }
}
