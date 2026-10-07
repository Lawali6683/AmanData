import { mountShell, showLoader, hideLoader, reveal, toast, escapeHtml, money } from './ui.js';
import { requireSession, accessToken } from './auth.js';

(function () {
    const API_ENDPOINT = '/api/profit';
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const VIEWS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    const rowList = $('rowList');

    let report = null;
    let view = 'daily';
    let busy = false;

    function currentMonth() {
        const d = new Date(Date.now() + 3600000);
        return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    }

    let month = currentMonth();

    function monthName(key) {
        const parts = key.split('-');
        return MONTHS[Number(parts[1]) - 1] + ' ' + parts[0];
    }

    function shiftMonth(key, step) {
        const parts = key.split('-');
        const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1 + step, 1));
        return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    }

    function dayLabel(date) {
        return new Date(date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
    }

    function rowsForView() {
        if (!report) return [];
        if (view === 'daily') {
            return report.days.slice().reverse().map((r) => ({ label: dayLabel(r.date), count: r.count, sales: r.sales, profit: r.profit }));
        }
        if (view === 'weekly') {
            const short = MONTHS[Number(month.split('-')[1]) - 1].slice(0, 3);
            return report.weeks.slice().reverse().map((r) => ({ label: 'Week ' + r.week + ' (' + r.from + '-' + r.to + ' ' + short + ')', count: r.count, sales: r.sales, profit: r.profit }));
        }
        return report.months.slice().reverse().map((r) => ({ label: monthName(r.month), count: r.count, sales: r.sales, profit: r.profit }));
    }

    function render() {
        $('monthLabel').textContent = monthName(month);
        $('btnNext').disabled = month >= currentMonth();
        const total = report ? report.total : { count: 0, sales: 0, profit: 0 };
        $('sumProfit').textContent = money(total.profit);
        $('sumCount').textContent = String(total.count);
        $('sumSales').textContent = money(total.sales);

        const rows = rowsForView();
        rowList.innerHTML = '';
        if (!rows.length) {
            rowList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-chart-line empty-icon"></i><h3 class="empty-title">No sales yet</h3><p class="empty-desc">Profit will appear here after the first sale in this period.</p></div>';
            return;
        }
        rows.forEach((r) => {
            const card = document.createElement('div');
            card.className = 'transaction-card';
            card.innerHTML =
                '<div class="tx-left"><div class="tx-icon-frame"><i class="fa-solid fa-coins"></i></div>' +
                '<div class="tx-meta"><span class="tx-title">' + escapeHtml(r.label) + '</span>' +
                '<span class="tx-date">' + r.count + ' sold • ₦' + escapeHtml(money(r.sales)) + '</span></div></div>' +
                '<div class="tx-right"><span class="tx-amount good">₦' + escapeHtml(money(r.profit)) + '</span></div>';
            rowList.appendChild(card);
        });
    }

    async function load() {
        let data = null;
        try {
            const token = await accessToken();
            if (!token) {
                window.location.replace('admin.html');
                return;
            }
            const res = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ action: 'report', month: month })
            });
            data = await res.json();
            if (res.status === 401 || res.status === 403) {
                toast(data.message || 'Access denied.', 'err');
                setTimeout(() => window.location.replace('admin.html'), 1800);
                return;
            }
        } catch (err) {
            data = null;
        }
        if (!data || !data.success) {
            toast((data && data.message) || 'Could not load the report. Try again.', 'err');
            return;
        }
        report = data;
        render();
    }

    async function changeMonth(step) {
        if (busy) return;
        const next = shiftMonth(month, step);
        if (next > currentMonth()) return;
        busy = true;
        month = next;
        showLoader();
        await load();
        hideLoader();
        busy = false;
    }

    function setView(v) {
        view = v;
        $('tabDaily').classList.toggle('active', v === 'daily');
        $('tabWeekly').classList.toggle('active', v === 'weekly');
        $('tabMonthly').classList.toggle('active', v === 'monthly');
        render();
    }

    function downloadPdf() {
        const rows = rowsForView();
        if (!rows.length) {
            toast('There is no data to put in the PDF yet.', 'err');
            return;
        }
        if (!window.jspdf) {
            toast('The PDF tool could not load. Check your connection.', 'err');
            return;
        }
        showLoader();
        setTimeout(() => {
            try {
                const doc = new window.jspdf.jsPDF();
                const first = view === 'daily' ? 'Day' : (view === 'weekly' ? 'Week' : 'Month');
                let count = 0;
                let sales = 0;
                let profit = 0;
                rows.forEach((r) => { count += r.count; sales += r.sales; profit += r.profit; });
                doc.setFontSize(18);
                doc.text('AmanData Profit Report', 14, 18);
                doc.setFontSize(11);
                doc.text('Report: ' + VIEWS[view] + (view === 'monthly' ? '' : ' - ' + monthName(month)), 14, 26);
                doc.text('Generated: ' + new Date().toLocaleString('en-GB'), 14, 32);
                doc.autoTable({
                    startY: 38,
                    head: [[first, 'Items Sold', 'Sales (NGN)', 'Profit (NGN)']],
                    body: rows.map((r) => [r.label, String(r.count), money(r.sales), money(r.profit)]),
                    foot: [['Total', String(count), money(sales), money(profit)]],
                    headStyles: { fillColor: [108, 92, 231] },
                    footStyles: { fillColor: [72, 52, 212] }
                });
                doc.save('amandata-profit-' + view + '-' + month + '.pdf');
                hideLoader();
                toast('Your PDF has been downloaded.', 'ok');
            } catch (err) {
                hideLoader();
                toast('Could not create the PDF. Try again.', 'err');
            }
        }, 700);
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
    $('btnPrev').addEventListener('click', () => changeMonth(-1));
    $('btnNext').addEventListener('click', () => changeMonth(1));
    $('tabDaily').addEventListener('click', () => setView('daily'));
    $('tabWeekly').addEventListener('click', () => setView('weekly'));
    $('tabMonthly').addEventListener('click', () => setView('monthly'));
    $('btnPdf').addEventListener('click', downloadPdf);

    initialize();
})();