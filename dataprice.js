import { supabase } from './client.js';
import { mountShell, showLoader, hideLoader, reveal, toast, escapeHtml, money } from './uix.js';
import { requireSession } from './auth.js';

(function () {
    const TABLES = { plan: 'plan_data', plan2: 'plan2_data' };

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    const overlay = $('sheetOverlay');

    let table = 'plan';
    let rows = [];
    let current = null;
    let leaves = [];
    let busy = false;
    let timer = null;

    function parse(value) {
        if (typeof value === 'string') {
            try { return JSON.parse(value); } catch (err) { return {}; }
        }
        return value === null || value === undefined ? {} : value;
    }

    function collect(value, path, out) {
        if (value !== null && typeof value === 'object') {
            Object.keys(value).forEach((k) => collect(value[k], path.concat(Array.isArray(value) ? Number(k) : k), out));
        } else {
            out.push({ path: path, value: value });
        }
    }

    function leavesOf(data) {
        const out = [];
        collect(data, [], out);
        return out;
    }

    function setIn(root, path, value) {
        if (!path.length) return value;
        let node = root;
        for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
        node[path[path.length - 1]] = value;
        return root;
    }

    function pathLabel(path) {
        return path.length ? path.join(' › ') : 'value';
    }

    function preview(data) {
        const all = leavesOf(data);
        const price = all.find((l) => /price|amount|cost/i.test(String(l.path[l.path.length - 1])) && isFinite(parseFloat(l.value)));
        const name = all.find((l) => /name|title|plan|network/i.test(String(l.path[l.path.length - 1])) && typeof l.value === 'string' && l.value);
        return { count: all.length, price: price ? '₦' + money(price.value) : null, name: name ? name.value : null };
    }

    function matches(query) {
        const text = query.trim().toLowerCase();
        if (!text) return rows;
        return rows.filter((r) => (r.id + ' ' + JSON.stringify(r.data)).toLowerCase().includes(text));
    }

    function renderList() {
        const query = $('searchInput').value;
        const found = matches(query);
        $('searchInfo').textContent = found.length + ' of ' + rows.length + ' rows shown.';
        if (!found.length) {
            $('rowList').innerHTML = '<div class="empty-state"><i class="fa-solid fa-tags empty-icon"></i><h3 class="empty-title">Nothing found</h3><p class="empty-desc">No row in this table matches your search.</p></div>';
            return;
        }
        $('rowList').innerHTML = found.map((r) => {
            const p = preview(r.data);
            return '<div class="user-card"><div class="user-main"><div class="avatar"><i class="fa-solid fa-tag"></i></div><div class="user-meta"><span class="user-name">' + escapeHtml(p.name || r.id) + '</span><span class="user-email">' + escapeHtml(r.id) + ' • ' + p.count + ' fields' + (p.price ? ' • ' + escapeHtml(p.price) : '') + '</span></div></div>' +
                '<button type="button" class="btn-small" data-edit="' + escapeHtml(r.id) + '">Edit</button></div>';
        }).join('');
    }

    function renderLeaves() {
        const filter = $('leafFilter').value.trim().toLowerCase();
        const html = [];
        leaves.forEach((l, i) => {
            const label = pathLabel(l.path);
            if (filter && !label.toLowerCase().includes(filter) && !String(l.value).toLowerCase().includes(filter)) return;
            html.push('<div class="field"><label for="leaf' + i + '">' + escapeHtml(label) + '</label><input class="input" id="leaf' + i + '" data-leaf="' + i + '" value="' + escapeHtml(l.value === null ? '' : l.value) + '" autocomplete="off" spellcheck="false"></div>');
        });
        $('leafList').innerHTML = html.length ? html.join('') : '<p class="form-desc">No field matches the filter.</p>';
    }

    function openSheet(row) {
        current = row;
        leaves = leavesOf(row.data);
        $('sheetTitle').textContent = 'Edit ' + row.id;
        $('leafFilter').value = '';
        renderLeaves();
        overlay.classList.add('open');
        document.body.classList.add('locked');
    }

    function closeSheet() {
        overlay.classList.remove('open');
        document.body.classList.remove('locked');
        current = null;
    }

    function syncInputs() {
        document.querySelectorAll('[data-leaf]').forEach((input) => {
            leaves[Number(input.getAttribute('data-leaf'))].next = input.value;
        });
    }

    async function save() {
        if (busy || !current) return;
        syncInputs();
        const data = JSON.parse(JSON.stringify(current.data));
        let failed = null;
        leaves.forEach((l) => {
            if (failed || l.next === undefined) return;
            let value = l.next;
            if (typeof l.value === 'number') {
                const n = Number(value);
                if (value.trim() === '' || !isFinite(n)) { failed = pathLabel(l.path) + ' must be a number.'; return; }
                value = n;
            } else if (typeof l.value === 'boolean') {
                value = value.trim().toLowerCase() === 'true';
            } else if (l.value === null && value === '') {
                value = null;
            }
            if (value !== l.value) setIn(data, l.path, value);
        });
        if (failed) {
            toast(failed, 'err');
            return;
        }
        busy = true;
        showLoader();
        let result;
        try {
            result = await supabase.from(table).update({ [TABLES[table]]: data }).eq('id', current.id).select('id');
        } catch (err) {
            result = { error: err };
        }
        hideLoader();
        busy = false;
        if (result.error || !result.data || !result.data.length) {
            toast(result.error ? result.error.message : 'Not saved. You may not have access to change this row.', 'err');
            return;
        }
        current.data = data;
        closeSheet();
        renderList();
        toast('Changes saved.', 'ok');
    }

    async function load() {
        try {
            const { data, error } = await supabase.from(table).select('*').order('id');
            if (error) throw error;
            rows = data.map((r) => ({ id: String(r.id), data: parse(r[TABLES[table]]) }));
        } catch (err) {
            rows = [];
            toast('Could not load this table. Check your connection and access.', 'err');
        }
        renderList();
    }

    async function reload() {
        if (busy) return;
        busy = true;
        showLoader();
        await load();
        hideLoader();
        busy = false;
    }

    async function setTable(name) {
        if (busy || name === table) return;
        table = name;
        $('tabPlan').classList.toggle('active', name === 'plan');
        $('tabPlan2').classList.toggle('active', name === 'plan2');
        $('searchInput').value = '';
        await reload();
    }

    $('rowList').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-edit]');
        if (!btn) return;
        const row = rows.find((r) => r.id === btn.getAttribute('data-edit'));
        if (row) openSheet(row);
    });
    $('leafList').addEventListener('input', syncInputs);
    $('leafFilter').addEventListener('input', () => { syncInputs(); renderLeaves(); });
    $('btnSave').addEventListener('click', save);
    $('btnCancel').addEventListener('click', closeSheet);
    $('btnClose').addEventListener('click', closeSheet);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open') && !busy) closeSheet(); });
    $('searchInput').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(renderList, 120); });
    $('tabPlan').addEventListener('click', () => setTable('plan'));
    $('tabPlan2').addEventListener('click', () => setTable('plan2'));
    $('btnBack').addEventListener('click', () => { window.location.href = 'admin.html'; });
    $('btnRefresh').addEventListener('click', reload);

    async function initialize() {
        try {
            const session = await requireSession();
            if (!session) return;
            await load();
        } finally {
            reveal(container, 1200);
        }
    }

    initialize();
})();
