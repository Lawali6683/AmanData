import { supabase } from './supabase.js';
import { mountShell, showLoader, hideLoader, reveal, toast, escapeHtml, money, confirmDialog } from './uix.js';
import { requireSession } from './auth.js';

(function () {
    const PAGE = 1000;
    const ORDER = ['full_name', 'email', 'phone_number', 'user_balance', 'referral_code', 'referral_link', 'referred_by', 'register_date', 'ip_address', 'device', 'location', 'pin', 'password', 'virtual_accounts', 'transactions'];
    const SECRET = ['pin', 'password'];
    const LABELS = { full_name: 'Full name', email: 'Email', phone_number: 'Phone number', user_balance: 'Balance', referral_code: 'Referral code', referral_link: 'Referral link', referred_by: 'Referred by', register_date: 'Registered', ip_address: 'IP address', device: 'Device', location: 'Location', pin: 'PIN', password: 'Password', virtual_accounts: 'Virtual accounts', transactions: 'Transactions' };

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    const overlay = $('sheetOverlay');
    const body = $('sheetBody');

    let users = [];
    let current = null;
    let mode = 'view';
    let busy = false;
    let timer = null;

    function normalize(row) {
        let data = row.user_data;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (err) { data = {}; }
        }
        return { id: row.id, data: data && typeof data === 'object' ? data : {} };
    }

    async function fetchAll() {
        const all = [];
        let from = 0;
        for (;;) {
            const { data, error } = await supabase.from('user_profiles').select('id,user_data').order('id').range(from, from + PAGE - 1);
            if (error) throw error;
            data.forEach((row) => all.push(normalize(row)));
            if (data.length < PAGE) break;
            from += PAGE;
        }
        return all;
    }

    function balanceOf(u) {
        const n = parseFloat(String(u.data.user_balance === undefined || u.data.user_balance === null ? 0 : u.data.user_balance).replace(/,/g, ''));
        return isFinite(n) ? n : 0;
    }

    function nameOf(u) {
        return String(u.data.full_name || 'No name');
    }

    function orderedKeys(data) {
        const keys = Object.keys(data);
        const first = ORDER.filter((k) => keys.includes(k));
        const rest = keys.filter((k) => !ORDER.includes(k)).sort();
        return first.concat(rest);
    }

    function label(key) {
        return LABELS[key] || key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    }

    function renderStats() {
        let total = 0;
        let funded = 0;
        users.forEach((u) => {
            const b = balanceOf(u);
            total += b;
            if (b > 0) funded++;
        });
        $('statTotal').textContent = users.length.toLocaleString('en-NG');
        $('statMoney').textContent = '₦' + money(Math.round(total * 100) / 100);
        $('statFunded').textContent = funded.toLocaleString('en-NG');
        $('statEmpty').textContent = (users.length - funded).toLocaleString('en-NG');
    }

    function findMatches(query) {
        const text = query.trim().toLowerCase();
        if (!text) {
            return users.slice().sort((a, b) => String(b.data.register_date || '').localeCompare(String(a.data.register_date || ''))).slice(0, 10);
        }
        const words = text.split(/\s+/);
        return users.filter((u) => {
            const hay = [nameOf(u), u.data.email, u.data.phone_number].join(' ').toLowerCase();
            return words.every((w) => hay.includes(w));
        }).sort((a, b) => {
            const sa = nameOf(a).toLowerCase().startsWith(text) ? 0 : 1;
            const sb = nameOf(b).toLowerCase().startsWith(text) ? 0 : 1;
            return sa - sb || nameOf(a).localeCompare(nameOf(b));
        }).slice(0, 50);
    }

    function renderList() {
        const query = $('searchInput').value;
        const list = findMatches(query);
        const holder = $('userList');
        $('searchInfo').textContent = query.trim()
            ? list.length + (list.length === 1 ? ' user matches' : ' users match') + ' your search.'
            : 'Showing the 10 newest users. Type to search all ' + users.length.toLocaleString('en-NG') + ' users.';
        if (!list.length) {
            holder.innerHTML = '<div class="empty-state"><i class="fa-solid fa-user-slash empty-icon"></i><h3 class="empty-title">No user found</h3><p class="empty-desc">Check the spelling or try the email or phone number.</p></div>';
            return;
        }
        holder.innerHTML = list.map((u) =>
            '<div class="user-card"><div class="user-main"><div class="avatar">' + escapeHtml(nameOf(u).charAt(0).toUpperCase()) + '</div>' +
            '<div class="user-meta"><span class="user-name">' + escapeHtml(nameOf(u)) + '</span><span class="user-email">' + escapeHtml(u.data.email || '-') + '</span></div></div>' +
            '<button type="button" class="btn-small" data-view="' + escapeHtml(u.id) + '">View</button></div>'
        ).join('');
    }

    function valueText(value) {
        if (value === null || value === undefined || value === '') return '-';
        if (typeof value === 'object') return JSON.stringify(value, null, 1);
        return String(value);
    }

    function viewHtml(u) {
        let html = '<div class="data-grid"><div class="data-item full"><div class="data-label">User ID (UUID)</div><div class="data-value mono">' + escapeHtml(u.id) + '</div></div>';
        orderedKeys(u.data).forEach((key) => {
            const value = u.data[key];
            const complex = value !== null && typeof value === 'object';
            const secret = SECRET.includes(key) && value;
            const shown = key === 'user_balance' ? '₦' + money(value) : (secret ? '••••••' : valueText(value));
            html += '<div class="data-item' + (complex || key === 'referral_link' ? ' full' : '') + '"><div class="data-label">' + escapeHtml(label(key)) + '</div>' +
                '<div class="data-value' + (complex || secret ? ' mono' : '') + '" data-key="' + escapeHtml(key) + '">' + escapeHtml(shown) + '</div>' +
                (secret ? '<button type="button" class="reveal-btn" data-reveal="' + escapeHtml(key) + '">Show</button>' : '') + '</div>';
        });
        html += '</div><div class="actions-2"><button type="button" class="btn-small danger" id="btnDelete"><i class="fa-solid fa-trash-can"></i> Delete</button>' +
            '<button type="button" class="btn-small" id="btnEdit"><i class="fa-solid fa-pen"></i> Edit</button></div>';
        return html;
    }

    function editHtml(u) {
        let html = '<div class="field"><label>User ID (UUID)</label><input class="input" value="' + escapeHtml(u.id) + '" readonly></div>';
        orderedKeys(u.data).forEach((key) => {
            const value = u.data[key];
            const complex = value !== null && typeof value === 'object';
            const text = complex ? JSON.stringify(value, null, 2) : (value === null || value === undefined ? '' : String(value));
            html += '<div class="field"><label for="f_' + escapeHtml(key) + '">' + escapeHtml(label(key)) + '</label>' +
                (complex
                    ? '<textarea class="input" id="f_' + escapeHtml(key) + '" data-field="' + escapeHtml(key) + '" spellcheck="false">' + escapeHtml(text) + '</textarea>'
                    : '<input class="input" id="f_' + escapeHtml(key) + '" data-field="' + escapeHtml(key) + '" value="' + escapeHtml(text) + '" autocomplete="off" spellcheck="false">') +
                '</div>';
        });
        html += '<div class="actions-2"><button type="button" class="btn-small alt" id="btnCancel">Cancel</button><button type="button" class="btn-primary" id="btnSave">Save changes</button></div>';
        return html;
    }

    function renderSheet() {
        $('sheetTitle').textContent = (mode === 'edit' ? 'Edit ' : '') + nameOf(current);
        body.innerHTML = mode === 'edit' ? editHtml(current) : viewHtml(current);
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.style.gap = '16px';
    }

    function openSheet(u) {
        current = u;
        mode = 'view';
        renderSheet();
        overlay.classList.add('open');
        document.body.classList.add('locked');
    }

    function closeSheet() {
        overlay.classList.remove('open');
        document.body.classList.remove('locked');
        current = null;
    }

    function rpcMessage(error) {
        if (error && (error.code === 'PGRST202' || /does not exist|schema cache/i.test(error.message || ''))) {
            return 'The admin functions are not installed. Run ceo.sql in the Supabase SQL editor.';
        }
        return (error && error.message) || 'Something went wrong. Try again.';
    }

    function collect() {
        const out = {};
        let failed = null;
        orderedKeys(current.data).forEach((key) => {
            const input = body.querySelector('[data-field="' + key.replace(/"/g, '') + '"]');
            if (!input || failed) return;
            const original = current.data[key];
            const raw = input.value;
            if (original !== null && typeof original === 'object') {
                try { out[key] = JSON.parse(raw); } catch (err) { failed = label(key) + ' must be valid JSON.'; }
            } else if (typeof original === 'number') {
                const n = Number(raw);
                if (raw.trim() === '' || !isFinite(n)) failed = label(key) + ' must be a number.';
                else out[key] = n;
            } else if (typeof original === 'boolean') {
                out[key] = raw.trim().toLowerCase() === 'true';
            } else if ((original === null || original === undefined) && raw === '') {
                out[key] = null;
            } else {
                out[key] = raw;
            }
        });
        return { data: out, error: failed };
    }

    async function save() {
        if (busy || !current) return;
        const result = collect();
        if (result.error) {
            toast(result.error, 'err');
            return;
        }
        const email = String(result.data.email || '').trim();
        if (email && !/^\S+@\S+\.\S+$/.test(email)) {
            toast('Enter a valid email address.', 'err');
            return;
        }
        busy = true;
        showLoader();
        let response;
        try {
            response = await supabase.rpc('admin_update_user', { p_id: current.id, p_data: result.data });
        } catch (err) {
            response = { error: err };
        }
        hideLoader();
        busy = false;
        if (response.error) {
            toast(rpcMessage(response.error), 'err');
            return;
        }
        current.data = result.data;
        mode = 'view';
        renderSheet();
        renderStats();
        renderList();
        toast('Changes saved.', 'ok');
    }

    async function removeUser() {
        if (busy || !current) return;
        const target = current;
        const ok = await confirmDialog({
            title: 'Delete user',
            html: 'Delete <strong>' + escapeHtml(nameOf(target)) + '</strong> (' + escapeHtml(target.data.email || target.id) + ') completely? Their login, profile and data will be removed. They must register again to use the app. This cannot be undone.',
            okLabel: 'Delete user',
            noLabel: 'Keep',
            danger: true
        });
        if (!ok) return;
        busy = true;
        showLoader();
        let response;
        try {
            response = await supabase.rpc('admin_delete_user', { p_id: target.id });
        } catch (err) {
            response = { error: err };
        }
        hideLoader();
        busy = false;
        if (response.error) {
            toast(rpcMessage(response.error), 'err');
            return;
        }
        users = users.filter((u) => u.id !== target.id);
        closeSheet();
        renderStats();
        renderList();
        toast('User deleted.', 'ok');
    }

    async function load() {
        try {
            users = await fetchAll();
        } catch (err) {
            toast('Could not load users. Check your connection and admin access.', 'err');
            return;
        }
        renderStats();
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

    $('userList').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-view]');
        if (!btn) return;
        const u = users.find((x) => x.id === btn.getAttribute('data-view'));
        if (u) openSheet(u);
    });

    body.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target || !current) return;
        if (target.id === 'btnEdit') { mode = 'edit'; renderSheet(); }
        else if (target.id === 'btnCancel') { mode = 'view'; renderSheet(); }
        else if (target.id === 'btnSave') save();
        else if (target.id === 'btnDelete') removeUser();
        else if (target.hasAttribute('data-reveal')) {
            const key = target.getAttribute('data-reveal');
            const cell = body.querySelector('.data-value[data-key="' + key + '"]');
            const hidden = target.textContent === 'Show';
            cell.textContent = hidden ? valueText(current.data[key]) : '••••••';
            target.textContent = hidden ? 'Hide' : 'Show';
        }
    });

    $('btnClose').addEventListener('click', closeSheet);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open') && !busy) closeSheet(); });
    $('searchInput').addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(renderList, 120);
    });
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