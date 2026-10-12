const PROVIDER = 'https://bilalsadasub.com';
const DATA_COLUMNS = ['mtn_plan', 'itel_data', 'glo_data', '9mobile_data'];
const EXAM_COLUMNS = ['wec_data', 'neco_data', 'nabteb_data', 'jamb_data'];
const AIRTIME_NETWORKS = [
    { item_id: 'mtn', name: 'MTN' },
    { item_id: 'airtel', name: 'AIRTEL' },
    { item_id: 'glo', name: 'GLO' },
    { item_id: '9mobile', name: '9MOBILE' }
];

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const snippet = (text) => String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').slice(0, 200);
const cleanRoot = (url) => String(url || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const toNumber = (v) => parseFloat(String(v === undefined || v === null ? 0 : v).replace(/,/g, '')) || 0;
const round2 = (n) => Math.round(n * 100) / 100;

async function rest(env, path, options) {
    const o = options || {};
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(cleanRoot(env.SUPABASE_URL) + '/rest/v1/' + path, {
        method: o.method || 'GET',
        body: o.body,
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: o.prefer || 'return=minimal' }
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = text; }
    return { ok: res.ok, status: res.status, data: data };
}

const rpc = (env, name, args) => rest(env, 'rpc/' + name, { method: 'POST', body: JSON.stringify(args), prefer: 'return=representation' });
const rpcMessage = (r) => (r.data && r.data.message ? String(r.data.message) : '');


function asList(value) {
    let v = value;
    if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch (err) { v = null; }
    }
    return Array.isArray(v) ? v : [];
}

async function firstRow(env, table) {
    const res = await rest(env, table + '?select=*&limit=1');
    if (!res.ok) throw new Error(table + ' ' + res.status + ' ' + snippet(res.data && res.data.message));
    return res.data && res.data[0] ? res.data[0] : {};
}

async function bestEffort(env, table) {
    try {
        const res = await rest(env, table + '?select=*&limit=1');
        return res.ok && res.data && res.data[0] ? res.data[0] : null;
    } catch (err) {
        return null;
    }
}

function priced(list) {
    return list.filter((p) => p && Number(p.price) > 0);
}

async function pricingMap(env, service) {
    const map = {};
    try {
        const res = await rest(env, 'bill_pricing?service=eq.' + service + '&select=item_id,mode,value,enabled');
        if (res.ok && Array.isArray(res.data)) res.data.forEach((r) => { map[String(r.item_id)] = r; });
    } catch (err) {
        return map;
    }
    return map;
}

function withRule(item, map) {
    const r = map[item.item_id];
    return Object.assign({}, item, {
        mode: r && r.mode === 'fixed' ? 'fixed' : 'percent',
        value: r ? Number(r.value) || 0 : 0,
        enabled: r ? r.enabled !== false : true
    });
}

export async function onRequest({ request, env }) {
    if (request.method !== 'GET' && request.method !== 'POST') return json({ success: false, message: 'Method Not Allowed' }, 405);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        return json({ success: false, message: 'Server setup is incomplete: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.' }, 500);
    }

    let type = new URL(request.url).searchParams.get('type') || '';
    if (!type && request.method === 'POST') {
        try { type = String((await request.json()).type || ''); } catch (err) { type = ''; }
    }

    try {
        if (type === 'data') {
            const row = await firstRow(env, 'buydata');
            const simple = {};
            DATA_COLUMNS.forEach((c) => {
                const list = priced(asList(row[c])).map((p) => ({ plan_id: String(p.plan_id), plan_name: p.plan_name, plan_type: p.plan_type || '', plan_day: p.plan_day || '', price: Number(p.price) }));
                if (list.length) simple[c] = list;
            });
            const easyRow = await bestEffort(env, 'myapi');
            const easy = {};
            if (easyRow) {
                DATA_COLUMNS.forEach((c) => {
                    const list = priced(asList(easyRow[c])).map((p) => ({ plan_id: String(p.plan_id), plan_name: p.plan_name, plan_type: p.plan_type || '', plan_day: p.plan_day || '', price: Number(p.price) }));
                    if (list.length) easy[c] = list;
                });
            }
            let online = null;
            try {
                const res = await rest(env, 'sim_status?select=network,online');
                if (res.ok && Array.isArray(res.data)) {
                    online = {};
                    res.data.forEach((r) => { online[r.network] = !!r.online; });
                }
            } catch (err) {
                online = null;
            }
            const columnCounts = {};
            DATA_COLUMNS.forEach((col) => { columnCounts[col] = simple[col] ? simple[col].length : 0; });
            return json({
                success: true,
                simple: simple,
                easy: easy,
                online: online,
                meta: { table: 'buydata', row_found: Object.keys(row).length > 0, columns: Object.keys(row), priced_plans: columnCounts }
            });
        }

        if (type === 'exam') {
            const row = await firstRow(env, 'exampins');
            const exams = {};
            EXAM_COLUMNS.forEach((c) => {
                const list = priced(asList(row[c])).map((x) => ({ exam_id: String(x.exam_id), exam_name: x.exam_name, mode: x.mode || '', price: Number(x.price) }));
                if (list.length) exams[c] = list;
            });
            const examCounts = {};
            EXAM_COLUMNS.forEach((col) => { examCounts[col] = exams[col] ? exams[col].length : 0; });
            return json({
                success: true,
                exams: exams,
                meta: { table: 'exampins', row_found: Object.keys(row).length > 0, columns: Object.keys(row), priced_items: examCounts }
            });
        }

        if (type === 'cable') {
            const row = await firstRow(env, 'cabletv');
            const cable = {};
            priced(asList(row.alltv_plan)).forEach((p) => {
                const k = String(p.cable_name || '');
                if (!k) return;
                if (!cable[k]) cable[k] = [];
                cable[k].push({ plan_id: String(p.plan_id), plan_name: p.plan_name, cable_name: k, price: Number(p.price) });
            });
            return json({ success: true, cable: cable });
        }

        if (type === 'airtime') {
            const map = await pricingMap(env, 'airtime');
            return json({ success: true, networks: AIRTIME_NETWORKS.map((n) => withRule(n, map)) });
        }

        if (type === 'electricity') {
            const res = await fetch(PROVIDER + '/api/v1/plans/discos', {
                headers: { Accept: 'application/json', Authorization: 'Bearer ' + env.BILAL_API_KEY, 'X-API-Key': env.BILAL_API_KEY },
                signal: AbortSignal.timeout(12000)
            });
            let data = null;
            try { data = await res.json(); } catch (err) { data = null; }
            if (!data || !Array.isArray(data.data)) {
                return json({ success: false, message: 'Electricity companies could not be loaded (' + res.status + '). Please try again later.' }, 502);
            }
            const map = await pricingMap(env, 'electricity');
            const discos = data.data.map((d) => withRule({ item_id: String(d.plan_id), plan_id: String(d.plan_id), disco_name: String(d.disco_name || ''), logo: d.logo ? String(d.logo) : '' }, map));
            return json({ success: true, discos: discos });
        }

        return json({ success: false, message: 'Unknown catalog type.' }, 400);
    } catch (err) {
        console.error('catalog error', type, err && err.message);
        return json({ success: false, message: 'The price list could not be loaded: ' + snippet(err && err.message) }, 500);
    }
}
