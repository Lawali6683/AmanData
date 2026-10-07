import { supabase } from './supabase.js';
import { mountShell, showLoader, hideLoader, reveal, toast, escapeHtml, money } from './uix.js';
import { requireSession } from './auth.js';

(function () {
    const PAGE = 1000;
    const SECRET = ['pin', 'password'];

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    let busy = false;

    function show(card) {
        $('resultCard').classList.toggle('hidden', card !== 'result');
        $('noResult').classList.toggle('hidden', card !== 'none');
    }

    function parse(value) {
        if (typeof value === 'string') {
            try { return JSON.parse(value); } catch (err) { return {}; }
        }
        return value && typeof value === 'object' ? value : {};
    }

    async function loadStats() {
        try {
            let total = 0;
            let funded = 0;
            let from = 0;
            for (;;) {
                const { data, error } = await supabase.from('user_profiles').select('id,b:user_data->>user_balance').order('id').range(from, from + PAGE - 1);
                if (error || !data) return;
                data.forEach((row) => {
                    total++;
                    if (parseFloat(String(row.b || 0).replace(/,/g, '')) > 0) funded++;
                });
                if (data.length < PAGE) break;
                from += PAGE;
            }
            $('totalUsers').textContent = total.toLocaleString('en-NG');
            $('withBalance').textContent = funded.toLocaleString('en-NG');
            $('withoutBalance').textContent = (total - funded).toLocaleString('en-NG');
        } catch (err) {}
    }

    function item(label, value, cls, full) {
        return '<div class="data-item' + (full ? ' full' : '') + '"><div class="data-label">' + escapeHtml(label) + '</div><div class="data-value ' + (cls || '') + '">' + escapeHtml(value) + '</div></div>';
    }

    function render(row) {
        const user = parse(row.user_data);
        $('userId').textContent = 'ID: ' + row.id;
        let html = '';
        Object.keys(user).forEach((key) => {
            const value = user[key];
            const label = key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
            if (SECRET.includes(key)) {
                html += item(label, value ? '••••••' : '-', 'mono');
            } else if (key === 'user_balance') {
                html += item(label, '₦' + money(value), 'good');
            } else if (value !== null && typeof value === 'object') {
                const rows = Array.isArray(value) ? value : [value];
                html += '<div class="data-item full"><div class="data-label">' + escapeHtml(label) + (Array.isArray(value) ? ' (' + value.length + ')' : '') + '</div>' +
                    rows.slice(-5).map((r, i) => '<div class="data-value mono">' + (i + 1) + '. ' + escapeHtml(typeof r === 'object' ? JSON.stringify(r) : r) + '</div>').join('') + '</div>';
            } else {
                html += item(label, value === null || value === '' ? '-' : value, '', key === 'referral_link');
            }
        });
        $('dataGrid').innerHTML = html;
        show('result');
    }

    async function search(event) {
        event.preventDefault();
        if (busy) return;
        const query = $('searchInput').value.trim().replace(/[,()%*\\]/g, '');
        if (!query) {
            toast('Enter a name, email, phone number or account number.', 'err');
            return;
        }
        busy = true;
        showLoader();
        let result;
        try {
            result = await supabase.from('user_profiles').select('id,user_data')
                .or('user_data->>full_name.ilike.%' + query + '%,user_data->>email.ilike.%' + query + '%,user_data->>phone_number.ilike.%' + query + '%,user_data->>virtual_accounts.ilike.%' + query + '%')
                .limit(1);
        } catch (err) {
            result = { error: err };
        }
        hideLoader();
        busy = false;
        if (result.error) {
            toast('Search failed. Check your connection and try again.', 'err');
            return;
        }
        if (result.data && result.data.length) {
            render(result.data[0]);
            toast('User found.', 'ok');
        } else {
            show('none');
            toast('No user matches that search.', 'err');
        }
    }

    async function initialize() {
        try {
            const session = await requireSession();
            if (!session) return;
            await loadStats();
        } finally {
            reveal(container, 1200);
        }
    }

    $('btnBack').addEventListener('click', () => { window.location.href = 'admin.html'; });
    $('searchForm').addEventListener('submit', search);
    $('btnAnother').addEventListener('click', () => {
        $('searchInput').value = '';
        show('');
        $('searchInput').focus();
    });

    initialize();
})();