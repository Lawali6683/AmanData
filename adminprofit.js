import { mountShell, showLoader, hideLoader, reveal, toast, escapeHtml, money, confirmDialog, apiPost, LOGO } from './uix.js';
import { requireSession, accessToken } from './auth.js';

(function () {
    const ENDPOINT = '/api/adminprofit';
    let referralPercent = 1;
    let ownerPercent = 40;

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    const list = $('profitList');

    let items = [];
    let owner = { email: '', found: true };
    let pin = '';
    let busy = false;

    const round2 = (n) => Math.round(n * 100) / 100;

    function profitOf(item) {
        const n = Number(item.profit);
        return isFinite(n) && n > 0 ? n : 0;
    }

    function formatDate(value) {
        const d = new Date(value);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function ownerShare(item) {
        const v = profitOf(item);
        const ref = item.has_referrer ? round2((v * referralPercent) / 100) : 0;
        return round2(((v - ref) * ownerPercent) / 100);
    }

    function kindLabel(kind) {
        return kind === 'pending' ? 'Failed to share' : 'Old sale not shared';
    }

    async function call(payload) {
        const token = await accessToken();
        if (!token) {
            window.location.reload();
            return { success: false, message: 'Please sign in again.' };
        }
        const r = await apiPost(ENDPOINT, token, Object.assign({ pin: pin }, payload));
        if (r.status === 401) setTimeout(() => window.location.reload(), 2200);
        return r.data;
    }

    function card(item) {
        const ref = escapeHtml(item.reference);
        const usable = profitOf(item) > 0;
        return '<article class="w-card" data-ref="' + ref + '">' +
            '<div class="w-top"><label class="w-name pick-row"><input type="checkbox" class="pick js-pick"' + (item.picked ? ' checked' : '') + (usable ? '' : ' disabled') + '>' +
            '<span>' + escapeHtml(item.description || item.reference) + '</span></label></div>' +
            '<div class="w-age"><i class="fa-regular fa-clock"></i> ' + escapeHtml(formatDate(item.created_at)) + ' • ' + escapeHtml(kindLabel(item.kind)) + '</div>' +
            (item.reason ? '<div class="badge low"><i class="fa-solid fa-circle-exclamation"></i> ' + escapeHtml(item.reason) + '</div>' : '') +
            (usable ? '' : '<div class="badge low"><i class="fa-solid fa-circle-exclamation"></i> No profit was recorded for this item.</div>') +
            (item.error ? '<div class="badge bad"><i class="fa-solid fa-triangle-exclamation"></i> ' + escapeHtml(item.error) + '</div>' : '') +
            '<div class="w-row"><span class="k">Service</span><span class="v">' + escapeHtml(item.service || '-') + '</span></div>' +
            '<div class="w-row"><span class="k">Sold for</span><span class="v">₦' + escapeHtml(money(item.price)) + '</span></div>' +
            '<div class="w-row"><span class="k">Cost</span><span class="v">₦' + escapeHtml(money(item.cost)) + '</span></div>' +
            '<div class="w-row"><span class="k">Profit</span><span class="v">₦' + escapeHtml(money(profitOf(item))) + '</span></div>' +
            '<div class="w-row"><span class="k">Owner receives</span><span class="v big">₦' + escapeHtml(money(ownerShare(item))) + '</span></div>' +
            '</article>';
    }

    function totals() {
        let count = 0;
        let profit = 0;
        let own = 0;
        items.forEach((it) => {
            if (!it.picked || profitOf(it) <= 0) return;
            count += 1;
            profit += profitOf(it);
            own += ownerShare(it);
        });
        return { count: count, profit: round2(profit), own: round2(own) };
    }

    function renderTotals() {
        const t = totals();
        $('statCount').textContent = String(t.count);
        $('statProfit').textContent = '₦' + money(t.profit);
        $('statOwner').textContent = '₦' + money(t.own);
    }

    function renderAll() {
        $('ownerLine').textContent = 'Owner: ' + owner.email + ' gets ' + ownerPercent + '% of the profit after ' + referralPercent + '% referral (if any).';
        $('ownerWarn').classList.toggle('hidden', owner.found !== false);
        $('listCount').textContent = items.length + (items.length === 1 ? ' item' : ' items');
        $('emptyState').classList.toggle('hidden', items.length > 0);
        list.innerHTML = items.map(card).join('');
        renderTotals();
    }

    async function loadQueue() {
        const result = await call({ action: 'queue' });
        if (!result || !result.success) return { ok: false, message: (result && result.message) || 'Could not load the list.' };
        if (result.percents) {
            referralPercent = Number(result.percents.referral) || 0;
            ownerPercent = Number(result.percents.owner) || 0;
        }
        owner = result.owner || owner;
        items = (Array.isArray(result.items) ? result.items : []).map((it) => Object.assign({}, it, {
            picked: it.kind === 'pending' && profitOf(it) > 0,
            error: ''
        }));
        renderAll();
        return { ok: true };
    }

    function askPin() {
        return new Promise((resolve) => {
            hideLoader();
            const overlay = document.createElement('div');
            overlay.className = 'login-overlay';
            overlay.innerHTML =
                '<div class="login-box"><img src="' + LOGO + '" class="page-logo" alt="Logo">' +
                '<section class="form-card"><h3 class="form-title">Enter PIN</h3><p class="form-desc">Enter the PIN for this page.</p>' +
                '<form id="pinForm" novalidate><div class="field"><label for="pinInput">PIN</label>' +
                '<input class="input" id="pinInput" type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="PIN"></div>' +
                '<button type="submit" class="btn-primary" id="pinBtn">Open</button></form></section>' +
                '<button type="button" class="link-btn" id="pinBack">Back to menu</button></div>';
            document.body.appendChild(overlay);
            const form = overlay.querySelector('#pinForm');
            const input = overlay.querySelector('#pinInput');
            const button = overlay.querySelector('#pinBtn');
            let checking = false;
            overlay.querySelector('#pinBack').addEventListener('click', () => { window.location.replace('admin.html'); });
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (checking) return;
                const value = input.value.trim();
                if (!value) {
                    toast('Enter the PIN.', 'err');
                    input.focus();
                    return;
                }
                checking = true;
                button.disabled = true;
                button.textContent = 'Checking...';
                pin = value;
                const r = await loadQueue();
                checking = false;
                button.disabled = false;
                button.textContent = 'Open';
                if (!r.ok) {
                    pin = '';
                    input.value = '';
                    toast(r.message, 'err');
                    return;
                }
                overlay.remove();
                showLoader();
                resolve();
            });
            input.focus();
        });
    }

    async function confirmCredit() {
        if (busy) return;
        const chosen = items.filter((it) => it.picked && profitOf(it) > 0);
        if (!chosen.length) {
            toast('Select at least one item.', 'err');
            return;
        }
        const t = totals();
        const ok = await confirmDialog({
            title: 'Confirm credit',
            html: 'Share <strong>₦' + escapeHtml(money(t.profit)) + '</strong> profit from <strong>' + t.count + '</strong> item(s)?<br>About <strong>₦' + escapeHtml(money(t.own)) + '</strong> will be added to <strong>' + escapeHtml(owner.email) + '</strong>.',
            okLabel: 'Yes, credit',
            noLabel: 'Cancel'
        });
        if (!ok) return;

        busy = true;
        showLoader();
        const result = await call({ action: 'credit', items: chosen.map((it) => ({ reference: it.reference })) });
        hideLoader();
        busy = false;

        if (!result || !result.success) {
            toast((result && result.message) || 'Could not credit. Try again.', 'err');
            return;
        }

        const done = {};
        const failed = [];
        (result.results || []).forEach((r) => {
            if (r.ok) {
                done[r.reference] = true;
            } else {
                failed.push(r);
                const it = items.find((x) => x.reference === r.reference);
                if (it) it.error = r.message;
            }
        });
        items = items.filter((x) => !done[x.reference]);
        renderAll();

        if (result.credited > 0) toast(result.credited + ' item(s) credited. Owner received ₦' + money(result.owner_total) + '.', 'ok');
        if (failed.length) toast(failed.length + ' item(s) failed: ' + failed[0].message, 'err');
    }

    list.addEventListener('change', (event) => {
        const box = event.target.closest('.js-pick');
        if (!box) return;
        const cardEl = box.closest('.w-card');
        const item = cardEl ? items.find((x) => x.reference === cardEl.getAttribute('data-ref')) : null;
        if (!item) return;
        item.picked = box.checked;
        renderTotals();
    });

    $('btnConfirm').addEventListener('click', confirmCredit);
    $('btnBack').addEventListener('click', () => { window.location.href = 'admin.html'; });
    $('btnRefresh').addEventListener('click', async () => {
        if (busy || !pin) return;
        busy = true;
        showLoader();
        const r = await loadQueue();
        hideLoader();
        busy = false;
        if (!r.ok) toast(r.message, 'err');
    });

    async function initialize() {
        try {
            const session = await requireSession();
            if (!session) return;
            await askPin();
        } catch (err) {
            toast('Something went wrong. Try again.', 'err');
        } finally {
            reveal(container, 1200);
        }
    }

    initialize();
})();
