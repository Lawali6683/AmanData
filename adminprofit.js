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

    function num(value) {
        const n = parseFloat(String(value === undefined || value === null ? '' : value).replace(/,/g, ''));
        return isFinite(n) ? n : null;
    }

    function makeId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID().replace(/-/g, '');
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    }

    function formatDate(value) {
        const d = new Date(value);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function split(item, value) {
        const v = value === null || value < 0 ? 0 : value;
        const ref = item.has_referrer ? round2((v * referralPercent) / 100) : 0;
        const own = round2(((v - ref) * ownerPercent) / 100);
        return { ref: ref, own: own };
    }

    function kindLabel(kind) {
        if (kind === 'pending') return 'Failed to share';
        if (kind === 'manual') return 'Added by hand';
        return 'Old sale not shared';
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
        const own = split(item, num(item.amount)).own;
        return '<article class="w-card" data-ref="' + ref + '">' +
            '<div class="w-top"><label class="w-name pick-row"><input type="checkbox" class="pick js-pick"' + (item.picked ? ' checked' : '') + '>' +
            '<span>' + escapeHtml(item.description || item.reference) + '</span></label></div>' +
            '<div class="w-age"><i class="fa-regular fa-clock"></i> ' + escapeHtml(formatDate(item.created_at)) + ' • ' + escapeHtml(kindLabel(item.kind)) + '</div>' +
            (item.reason ? '<div class="badge low"><i class="fa-solid fa-circle-exclamation"></i> ' + escapeHtml(item.reason) + '</div>' : '') +
            (item.error ? '<div class="badge bad"><i class="fa-solid fa-triangle-exclamation"></i> ' + escapeHtml(item.error) + '</div>' : '') +
            '<div class="w-row"><span class="k">Service</span><span class="v">' + escapeHtml(item.service || '-') + '</span></div>' +
            '<div class="w-row"><span class="k">Sold for</span><span class="v">₦' + escapeHtml(money(item.price)) + '</span></div>' +
            '<div class="w-row"><span class="k">Cost</span><span class="v">₦' + escapeHtml(money(item.cost)) + '</span></div>' +
            '<div class="w-row"><span class="k">Profit to share (₦)</span><span class="v"><input class="input js-amount" type="number" inputmode="decimal" min="0" step="0.01" value="' + escapeHtml(item.amount) + '" placeholder="Profit"></span></div>' +
            '<div class="w-row"><span class="k">Owner receives</span><span class="v big js-own">₦' + escapeHtml(money(own)) + '</span></div>' +
            (item.kind === 'manual' ? '<div class="w-actions"><button type="button" class="btn-small danger js-remove"><i class="fa-solid fa-trash-can"></i> Remove</button></div>' : '') +
            '</article>';
    }

    function totals() {
        let count = 0;
        let profit = 0;
        let own = 0;
        items.forEach((it) => {
            if (!it.picked) return;
            const v = num(it.amount);
            if (v === null || v <= 0) return;
            count += 1;
            profit += v;
            own += split(it, v).own;
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

    function findItem(node) {
        const cardEl = node.closest('.w-card');
        if (!cardEl) return null;
        const ref = cardEl.getAttribute('data-ref');
        const item = items.find((x) => x.reference === ref);
        return item ? { item: item, el: cardEl } : null;
    }

    async function loadQueue() {
        const result = await call({ action: 'queue' });
        if (!result || !result.success) return { ok: false, message: (result && result.message) || 'Could not load the list.' };
        const manual = items.filter((x) => x.kind === 'manual');
        if (result.percents) {
            referralPercent = Number(result.percents.referral) || 0;
            ownerPercent = Number(result.percents.owner) || 0;
        }
        owner = result.owner || owner;
        const fresh = (Array.isArray(result.items) ? result.items : []).map((it) => {
            const profit = Number(it.profit) || 0;
            return Object.assign({}, it, {
                amount: profit > 0 ? String(round2(profit)) : '',
                picked: it.kind === 'pending',
                error: ''
            });
        });
        items = fresh.concat(manual);
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
        const chosen = items.filter((it) => it.picked);
        if (!chosen.length) {
            toast('Select at least one item.', 'err');
            return;
        }
        const payload = [];
        for (const it of chosen) {
            const v = num(it.amount);
            if (v === null || v <= 0) {
                toast('Enter a profit above zero for ' + (it.description || it.reference) + '.', 'err');
                return;
            }
            payload.push({ reference: it.reference, profit: v });
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
        const result = await call({ action: 'credit', items: payload });
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

    list.addEventListener('input', (event) => {
        const input = event.target.closest('.js-amount');
        if (!input) return;
        const found = findItem(input);
        if (!found) return;
        found.item.amount = input.value;
        found.el.querySelector('.js-own').textContent = '₦' + money(split(found.item, num(input.value)).own);
        renderTotals();
    });

    list.addEventListener('change', (event) => {
        const box = event.target.closest('.js-pick');
        if (!box) return;
        const found = findItem(box);
        if (!found) return;
        found.item.picked = box.checked;
        renderTotals();
    });

    list.addEventListener('click', (event) => {
        const btn = event.target.closest('.js-remove');
        if (!btn) return;
        const found = findItem(btn);
        if (!found) return;
        items = items.filter((x) => x !== found.item);
        renderAll();
    });

    $('btnAddManual').addEventListener('click', () => {
        const v = num($('manualAmount').value);
        if (v === null || v <= 0) {
            toast('Enter a profit amount above zero.', 'err');
            return;
        }
        const note = $('manualNote').value.trim().slice(0, 80);
        items.unshift({
            kind: 'manual',
            reference: 'MANUAL_' + makeId(),
            user_id: '',
            service: 'manual',
            description: note || 'Manual entry',
            cost: 0,
            price: 0,
            profit: v,
            reason: '',
            created_at: new Date().toISOString(),
            has_referrer: false,
            amount: String(round2(v)),
            picked: true,
            error: ''
        });
        $('manualAmount').value = '';
        $('manualNote').value = '';
        renderAll();
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
