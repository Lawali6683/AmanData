(function () {
    const PASS_HASH = '4522d27a0589a4fc78b133d83f6c80a3a4bc6c0b91fbfafafb93884a026f109c';
    const $ = (id) => document.getElementById(id);
    const plans = [];

    const SQL_SETUP = [
        'create table if not exists public.data_sources (',
        '  id bigint generated always as identity primary key,',
        '  source_key text unique not null,',
        '  label text not null,',
        "  icon text default 'fa-wifi',",
        '  endpoint text not null,',
        '  sort_order int default 0,',
        '  active boolean default true,',
        '  created_at timestamptz default now()',
        ');',
        '',
        'create table if not exists public.data_plans (',
        '  id bigint generated always as identity primary key,',
        '  source_key text not null references public.data_sources(source_key) on delete cascade,',
        "  network_key text not null check (network_key in ('mtn_plan','itel_data','glo_data','9mobile_data')),",
        '  plan_id text not null,',
        '  plan_name text not null,',
        '  plan_type text,',
        '  plan_day text,',
        '  price numeric not null,',
        '  active boolean default true,',
        '  created_at timestamptz default now(),',
        '  unique (source_key, network_key, plan_id)',
        ');',
        '',
        'alter table public.data_sources enable row level security;',
        'alter table public.data_plans enable row level security;',
        '',
        'drop policy if exists "read active sources" on public.data_sources;',
        'create policy "read active sources" on public.data_sources',
        '  for select to anon, authenticated using (active = true);',
        '',
        'drop policy if exists "read active plans" on public.data_plans;',
        'create policy "read active plans" on public.data_plans',
        '  for select to anon, authenticated using (active = true);'
    ].join('\n');

    const API_DOC = [
        'POST /api/plan4',
        '',
        '{',
        '  "uuid": "user id",',
        '  "source": "plan4",',
        '  "network_key": "mtn_plan",',
        '  "plan_id": "101",',
        '  "phone": "08012345678",',
        '  "pin": "1234",',
        '  "request_id": "unique token"',
        '}',
        '',
        'Amsa mai nasara:',
        '{ "success": true, "message": "Purchase successful.", "balance": 4750 }',
        '',
        'Amsa mara nasara:',
        '{ "success": false, "message": "Dalili", "balance": 5000 }',
        '',
        'Idan ba ka da tabbaci (network/timeout):',
        '{ "success": false, "unsure": true, "message": "..." }',
        '',
        'Idan ana jira:',
        '{ "success": false, "pending": true, "message": "..." }'
    ].join('\n');

    const SQL_MANAGE = [
        "update public.data_sources set active = false where source_key = 'plan4';",
        '',
        "update public.data_sources set active = true where source_key = 'plan4';",
        '',
        "update public.data_plans set price = 300 where source_key = 'plan4' and network_key = 'mtn_plan' and plan_id = '101';",
        '',
        "delete from public.data_plans where source_key = 'plan4' and plan_id = '101';"
    ].join('\n');

    function sqlText(v) {
        return "'" + String(v).replace(/'/g, "''") + "'";
    }

    function bytesToHex(buf) {
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    async function sha256(text) {
        const data = new TextEncoder().encode(text);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return bytesToHex(digest);
    }

    async function tryOpen() {
        const value = $('pass').value.trim();
        if (!value) return;
        let hash = '';
        try {
            hash = await sha256(value);
        } catch (err) {
            $('passErr').textContent = 'Wannan na\'ura ba ta goyi bayan tantancewa.';
            return;
        }
        if (hash === PASS_HASH) {
            $('lockView').classList.add('hidden');
            $('appView').classList.remove('hidden');
            sessionStorage.setItem('adm_ok', '1');
        } else {
            $('passErr').textContent = 'Password ba daidai ba ne.';
            $('pass').value = '';
        }
    }

    function showBox(boxId, preId, text) {
        $(preId).textContent = text;
        $(boxId).classList.remove('hidden');
    }

    function validKey(v) {
        return /^[a-z][a-z0-9_]{1,30}$/.test(v);
    }

    function makeSourceSql() {
        const key = $('sKey').value.trim().toLowerCase();
        const label = $('sLabel').value.trim();
        const icon = $('sIcon').value.trim() || 'fa-wifi';
        const endpoint = $('sEndpoint').value.trim() || ('/api/' + key);
        const sort = parseInt($('sSort').value, 10) || 0;
        $('sErr').textContent = '';
        if (!validKey(key)) { $('sErr').textContent = 'source_key: ƙananan haruffa da lambobi kawai, misali plan4.'; return; }
        if (!label) { $('sErr').textContent = 'Saka sunan tab.'; return; }
        if (endpoint.charAt(0) !== '/') { $('sErr').textContent = 'Endpoint ya fara da /, misali /api/plan4.'; return; }
        const sql = [
            'insert into public.data_sources (source_key, label, icon, endpoint, sort_order, active)',
            'values (' + [sqlText(key), sqlText(label), sqlText(icon), sqlText(endpoint), sort, 'true'].join(', ') + ')',
            'on conflict (source_key) do update set',
            '  label = excluded.label,',
            '  icon = excluded.icon,',
            '  endpoint = excluded.endpoint,',
            '  sort_order = excluded.sort_order,',
            '  active = true;'
        ].join('\n');
        showBox('sourceBox', 'sqlSource', sql);
        $('pSource').value = key;
    }

    function renderPlans() {
        if (!plans.length) {
            $('pendingInfo').textContent = 'Babu plan a jeri tukuna.';
            $('planBox').classList.add('hidden');
            return;
        }
        $('pendingInfo').textContent = plans.length + ' plan(s) a jeri.';
        const rows = plans.map((p) => '  (' + [sqlText(p.source), sqlText(p.net), sqlText(p.id), sqlText(p.name), sqlText(p.type), sqlText(p.day), p.price, 'true'].join(', ') + ')');
        const sql = [
            'insert into public.data_plans (source_key, network_key, plan_id, plan_name, plan_type, plan_day, price, active)',
            'values',
            rows.join(',\n'),
            'on conflict (source_key, network_key, plan_id) do update set',
            '  plan_name = excluded.plan_name,',
            '  plan_type = excluded.plan_type,',
            '  plan_day = excluded.plan_day,',
            '  price = excluded.price,',
            '  active = true;'
        ].join('\n');
        showBox('planBox', 'sqlPlans', sql);
    }

    function addPlan() {
        const p = {
            source: $('pSource').value.trim().toLowerCase(),
            net: $('pNet').value,
            id: $('pId').value.trim(),
            name: $('pName').value.trim(),
            type: $('pType').value.trim(),
            day: $('pDay').value.trim(),
            price: Number($('pPrice').value)
        };
        $('pErr').textContent = '';
        if (!validKey(p.source)) { $('pErr').textContent = 'Saka source_key daidai.'; return; }
        if (!p.id || !p.name) { $('pErr').textContent = 'plan_id da plan_name wajibi ne.'; return; }
        if (!(p.price > 0)) { $('pErr').textContent = 'Saka farashi daidai.'; return; }
        plans.push(p);
        $('pId').value = '';
        $('pName').value = '';
        $('pPrice').value = '';
        renderPlans();
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            const area = document.createElement('textarea');
            area.value = text;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(area);
            return ok;
        }
    }

    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.copy');
        if (!btn) return;
        const ok = await copyText($(btn.dataset.target).textContent);
        btn.textContent = ok ? 'An kwafa' : 'Kuskure';
        btn.classList.toggle('done', ok);
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1600);
    });

    $('sqlSetup').textContent = SQL_SETUP;
    $('sqlApi').textContent = API_DOC;
    $('sqlManage').textContent = SQL_MANAGE;
    $('btnOpen').addEventListener('click', tryOpen);
    $('pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryOpen(); });
    $('sKey').addEventListener('input', () => {
        const k = $('sKey').value.trim().toLowerCase();
        if (!$('sEndpoint').value || $('sEndpoint').dataset.auto === '1') {
            $('sEndpoint').value = k ? '/api/' + k : '';
            $('sEndpoint').dataset.auto = '1';
        }
    });
    $('sEndpoint').addEventListener('input', () => { $('sEndpoint').dataset.auto = '0'; });
    $('btnSource').addEventListener('click', makeSourceSql);
    $('btnAddPlan').addEventListener('click', addPlan);
    $('btnClearPlans').addEventListener('click', () => { plans.length = 0; renderPlans(); });

    if (sessionStorage.getItem('adm_ok') === '1') {
        $('lockView').classList.add('hidden');
        $('appView').classList.remove('hidden');
    }
})();
