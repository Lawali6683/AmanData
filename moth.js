import { supabase } from './client.js';
import { mountShell, showLoader, hideLoader, reveal, toast, escapeHtml, money } from './uix.js';
import { requireSession } from './auth.js';

(function () {
    const PAGE = 300;
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    const list = $('dayList');
    let days = {};
    let busy = false;

    function lagosKey(value) {
        const d = new Date(value);
        if (isNaN(d.getTime())) return null;
        return new Date(d.getTime() + 3600000).toISOString().slice(0, 10);
    }

    function currentMonth() {
        return lagosKey(Date.now()).slice(0, 7);
    }

    let month = currentMonth();
    let earliest = month;

    function monthName(key) {
        const p = key.split('-');
        return MONTHS[Number(p[1]) - 1] + ' ' + p[0];
    }

    function shift(key, step) {
        const p = key.split('-');
        const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1 + step, 1));
        return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    }

    function txDate(t) {
        const v = t && (t.created_at || t.createdAt || t.date || t.time || t.timestamp);
        return v ? lagosKey(v) : null;
    }

    function txAmount(t) {
        const raw = t && (t.amount !== undefined ? t.amount : (t.price !== undefined ? t.price : t.total));
        const n = parseFloat(String(raw === undefined || raw === null ? 0 : raw).replace(/,/g, ''));
        return isFinite(n) ? n : 0;
    }

    function slot(key) {
        if (!days[key]) days[key] = { users: 0, tx: 0, volume: 0 };
        return days[key];
    }

    async function fetchAll() {
        days = {};
        let from = 0;
        for (;;) {
            const { data, error } = await supabase.from('user_profiles')
                .select('id,d:user_data->>register_date,t:user_data->transactions')
                .order('id').range(from, from + PAGE - 1);
            if (error) throw error;
            data.forEach((u) => {
                const k = u.d ? lagosKey(u.d) : null;
                if (k) slot(k).users++;
                const txs = typeof u.t === 'string' ? (() => { try { return JSON.parse(u.t); } catch (e) { return []; } })() : u.t;
                (Array.isArray(txs) ? txs : []).forEach((t) => {
                    const tk = txDate(t);
                    if (!tk) return;
                    const s = slot(tk);
                    s.tx++;
                    s.volume += txAmount(t);
                });
            });
            if (data.length < PAGE) break;
            from += PAGE;
        }
        const keys = Object.keys(days).sort();
        earliest = keys.length ? keys[0].slice(0, 7) : currentMonth();
    }

    function render() {
        $('monthLabel').textContent = monthName(month);
        $('btnNext').disabled = month >= currentMonth();
        $('btnPrev').disabled = month <= earliest;
        const keys = Object.keys(days).filter((k) => k.slice(0, 7) === month).sort().reverse();
        let users = 0;
        let tx = 0;
        let volume = 0;
        keys.forEach((k) => { users += days[k].users; tx += days[k].tx; volume += days[k].volume; });
        $('sumUsers').textContent = users.toLocaleString('en-NG');
        $('sumTx').textContent = tx.toLocaleString('en-NG');
        $('sumVolume').textContent = money(Math.round(volume * 100) / 100);
        if (!keys.length) {
            list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-chart-column empty-icon"></i><h3 class="empty-title">No activity</h3><p class="empty-desc">No registrations or transactions were found for this month.</p></div>';
            return;
        }
        list.innerHTML = keys.map((k) => {
            const s = days[k];
            const label = new Date(k + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
            return '<div class="transaction-card"><div class="tx-left"><div class="tx-icon-frame"><i class="fa-solid fa-calendar-day"></i></div><div class="tx-meta"><span class="tx-title">' + escapeHtml(label) + '</span><span class="tx-date">' + s.users + ' new • ' + s.tx + ' transactions</span></div></div><div class="tx-right"><span class="tx-amount good">₦' + escapeHtml(money(s.volume)) + '</span></div></div>';
        }).join('');
    }

    async function load() {
        try {
            await fetchAll();
        } catch (err) {
            toast('Could not load the data. Check your connection and access.', 'err');
            return;
        }
        render();
    }

    async function reload() {
        if (busy) return;
        busy = true;
        showLoader();
        await load();
        hideLoader();
        busy = false;
    }

    async function initialize() {
        try {
            const session = await requireSession();
            if (!session) return;
            await load();
        } finally {
            reveal(container, 1200);
        }
    }

    $('btnBack').addEventListener('click', () => { window.location.href = 'admin.html'; });
    $('btnRefresh').addEventListener('click', reload);
    $('btnPrev').addEventListener('click', () => { if (month > earliest) { month = shift(month, -1); render(); } });
    $('btnNext').addEventListener('click', () => { if (month < currentMonth()) { month = shift(month, 1); render(); } });

    initialize();
})();
