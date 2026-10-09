import { supabase } from './supabase.js';
import { mountShell, showLoader, hideLoader, reveal, toast, escapeHtml, money } from './uix.js';
import { requireSession } from './auth.js';

(function () {
    const PAGE = 1000;

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    let busy = false;

    function dayKey(value) {
        const d = new Date(value);
        if (isNaN(d.getTime())) return null;
        return new Date(d.getTime() + 3600000).toISOString().slice(0, 10);
    }

    function num(value) {
        const n = parseFloat(String(value === null || value === undefined ? 0 : value).replace(/,/g, ''));
        return isFinite(n) ? n : 0;
    }

    async function fetchAll() {
        const all = [];
        let from = 0;
        for (;;) {
            const { data, error } = await supabase.from('user_profiles')
                .select('id,n:user_data->>full_name,b:user_data->>user_balance,d:user_data->>register_date,r:user_data->>referred_by,c:user_data->>referral_code')
                .order('id').range(from, from + PAGE - 1);
            if (error) throw error;
            all.push(...data);
            if (data.length < PAGE) break;
            from += PAGE;
        }
        return all;
    }

    function row(rank, title, sub, amount) {
        return '<div class="transaction-card"><div class="tx-left"><div class="rank">' + rank + '</div><div class="tx-meta"><span class="tx-title">' + escapeHtml(title) + '</span><span class="tx-date">' + escapeHtml(sub) + '</span></div></div><div class="tx-right"><span class="tx-amount good">' + escapeHtml(amount) + '</span></div></div>';
    }

    function empty(text) {
        return '<p class="form-desc">' + escapeHtml(text) + '</p>';
    }

    function render(rows) {
        const today = dayKey(Date.now());
        const monthKey = today.slice(0, 7);
        const weekDays = [];
        for (let i = 6; i >= 0; i--) weekDays.push(dayKey(Date.now() - i * 86400000));
        const perDay = {};
        const refCount = {};
        const byCode = {};
        let total = 0;
        let funded = 0;
        let referred = 0;
        let month = 0;
        let week = 0;
        let todayCount = 0;

        rows.forEach((u) => {
            const b = num(u.b);
            total += b;
            if (b > 0) funded++;
            if (u.c) byCode[u.c] = u.n || u.c;
            if (u.r) {
                referred++;
                refCount[u.r] = (refCount[u.r] || 0) + 1;
            }
            const k = u.d ? dayKey(u.d) : null;
            if (!k) return;
            perDay[k] = (perDay[k] || 0) + 1;
            if (k === today) todayCount++;
            if (k.slice(0, 7) === monthKey) month++;
            if (weekDays.includes(k)) week++;
        });

        $('sumMoney').textContent = money(Math.round(total * 100) / 100);
        $('sumAvg').textContent = money(rows.length ? total / rows.length : 0);
        $('sumReferred').textContent = referred.toLocaleString('en-NG');
        $('stTotal').textContent = rows.length.toLocaleString('en-NG');
        $('stFunded').textContent = funded.toLocaleString('en-NG');
        $('stEmpty').textContent = (rows.length - funded).toLocaleString('en-NG');
        $('stToday').textContent = todayCount.toLocaleString('en-NG');
        $('stWeek').textContent = week.toLocaleString('en-NG');
        $('stMonth').textContent = month.toLocaleString('en-NG');

        const max = Math.max(1, ...weekDays.map((k) => perDay[k] || 0));
        $('weekBars').innerHTML = weekDays.map((k) => {
            const c = perDay[k] || 0;
            const label = new Date(k + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
            return '<div class="bar-row"><span class="bar-label">' + escapeHtml(label) + '</span><div class="bar-track"><div class="bar-fill" style="width:' + Math.round((c / max) * 100) + '%"></div></div><strong>' + c + '</strong></div>';
        }).join('');

        const top = rows.filter((u) => num(u.b) > 0).sort((a, b) => num(b.b) - num(a.b)).slice(0, 10);
        $('topBalances').innerHTML = top.length
            ? top.map((u, i) => row(i + 1, u.n || 'No name', u.c ? 'Code ' + u.c : 'User', '₦' + money(u.b))).join('')
            : empty('No user has money in the wallet yet.');

        const refs = Object.keys(refCount).sort((a, b) => refCount[b] - refCount[a]).slice(0, 5);
        $('topReferrers').innerHTML = refs.length
            ? refs.map((k, i) => row(i + 1, byCode[k] || k, 'Code ' + k, refCount[k] + ' referred')).join('')
            : empty('No referrals yet.');
    }

    async function load() {
        try {
            render(await fetchAll());
        } catch (err) {
            toast('Could not load users. Check your connection and access.', 'err');
        }
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
    $('btnRefresh').addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        showLoader();
        await load();
        hideLoader();
        busy = false;
    });

    initialize();
})();