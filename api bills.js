import { mountShell, showLoader, hideLoader, reveal, toast, escapeHtml, money, apiPost } from './uix.js';
import { requireSession, accessToken } from './auth.js';

(function () {
    const API_ENDPOINT = '/api/apibills';
    const LOGOS = {
        mtn: 'https://i.imgur.com/U82jQBd.png',
        airtel: 'https://i.imgur.com/aMgSbKX.png',
        glo: 'https://i.imgur.com/JlSw9vx.png',
        '9mobile': 'https://i.imgur.com/EM2g22Z.png'
    };
    const EXAMPLE = { airtime: 1000, electricity: 5000 };
    const FALLBACK_ICON = { airtime: 'fa-mobile-screen', electricity: 'fa-bolt' };

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    const list = $('itemList');

    let service = 'airtime';
    let items = [];
    let drafts = {};
    let busy = false;

    function num(value) {
        const n = parseFloat(String(value === undefined || value === null ? '' : value).replace(/,/g, ''));
        return isFinite(n) ? n : null;
    }

    async function call(payload) {
        const token = await accessToken();
        if (!token) {
            window.location.reload();
            return { success: false, message: 'Please sign in again.' };
        }
        const r = await apiPost(API_ENDPOINT, token, Object.assign({ service: service }, payload));
        if (r.status === 401) setTimeout(() => window.location.reload(), 2200);
        return r.data;
    }

    function charge(draft, amount) {
        const v = num(draft.value);
        if (v === null || v <= 0) return 0;
        return draft.mode === 'fixed' ? v : Math.round(amount * v) / 100;
    }

    function logoNode(item) {
        const frame = document.createElement('div');
        frame.className = 'tx-icon-frame';
        const icon = '<i class="fa-solid ' + FALLBACK_ICON[service] + '"></i>';
        const src = item.logo || (service === 'airtime' ? LOGOS[item.item_id] : '');
        if (!src) {
            frame.innerHTML = icon;
            return frame;
        }
        const img = document.createElement('img');
        img.alt = item.name;
        img.addEventListener('error', () => { frame.innerHTML = icon; });
        img.src = src;
        frame.appendChild(img);
        return frame;
    }

    function renderCount() {
        $('itemCount').textContent = String(items.filter((it) => drafts[it.item_id].enabled).length);
    }

    function renderItems() {
        list.innerHTML = '';
        renderCount();
        if (!items.length) {
            list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-xmark empty-icon"></i><h3 class="empty-title">Nothing found</h3><p class="empty-desc">The provider returned nothing for this section.</p></div>';
            return;
        }
        items.forEach((it) => {
            const d = drafts[it.item_id];
            const card = document.createElement('div');
            card.className = 'form-card';
            card.innerHTML =
                '<div class="tx-left"><span class="js-logo"></span><div class="tx-meta"><span class="tx-title">' + escapeHtml(it.name) + '</span>' +
                '<span class="tx-date js-state"></span></div></div>' +
                '<div class="bulk-row"><select class="input js-mode"><option value="percent">Percent %</option><option value="fixed">Fixed ₦</option></select>' +
                '<input class="input js-value" type="number" inputmode="decimal" min="0" step="0.5" placeholder="Profit"></div>' +
                '<div class="detail-rows"><div class="detail-row"><span class="detail-row-label">Example: user buys</span><span class="detail-row-val">₦' + money(EXAMPLE[service]) + '</span></div>' +
                '<div class="detail-row"><span class="detail-row-label">User pays</span><span class="detail-row-val js-pay">-</span></div></div>' +
                '<div class="bulk-row"><button type="button" class="btn-small alt js-toggle"></button><button type="button" class="btn-small js-save">Save</button></div>';
            card.querySelector('.js-logo').replaceWith(logoNode(it));
            const mode = card.querySelector('.js-mode');
            const value = card.querySelector('.js-value');
            const pay = card.querySelector('.js-pay');
            const toggle = card.querySelector('.js-toggle');
            const state = card.querySelector('.js-state');
            mode.value = d.mode;
            value.value = d.value;
            const refresh = () => {
                const v = num(d.value);
                pay.textContent = v !== null && v >= 0 ? '₦' + money(EXAMPLE[service] + charge(d, EXAMPLE[service])) : '-';
                toggle.innerHTML = d.enabled ? '<i class="fa-solid fa-eye"></i> On sale' : '<i class="fa-solid fa-eye-slash"></i> Hidden';
                state.innerHTML = d.enabled ? (it.saved ? '<span class="good">Saved</span>' : '<span class="muted">Default: no extra charge</span>') : '<span class="warn">Hidden from users</span>';
                renderCount();
            };
            mode.addEventListener('change', () => { d.mode = mode.value; refresh(); });
            value.addEventListener('input', () => { d.value = value.value; refresh(); });
            toggle.addEventListener('click', () => { d.enabled = !d.enabled; refresh(); });
            card.querySelector('.js-save').addEventListener('click', () => save([it.item_id]));
            refresh();
            list.appendChild(card);
        });
    }

    async function save(ids) {
        if (busy) return;
        const payload = [];
        for (const id of ids) {
            const d = drafts[id];
            const v = num(d.value);
            const name = (items.find((x) => x.item_id === id) || {}).name || id;
            if (v === null || v < 0 || (d.mode === 'percent' && v > 100)) {
                toast('Enter a valid profit for ' + name + ' (percent must be 0 to 100).', 'err');
                return;
            }
            payload.push({ item_id: id, mode: d.mode, value: v, enabled: d.enabled });
        }
        busy = true;
        showLoader();
        const result = await call({ action: 'save', items: payload });
        hideLoader();
        busy = false;
        if (result && result.success) {
            items.forEach((it) => { if (ids.includes(it.item_id)) it.saved = true; });
            renderItems();
            toast(result.message || 'Saved.', 'ok');
        } else {
            toast((result && result.message) || 'Could not save. Try again.', 'err');
        }
    }

    async function load() {
        const result = await call({ action: 'load' });
        if (!result || !result.success) {
            toast((result && result.message) || 'Could not load the list.', 'err');
            return false;
        }
        items = result.items || [];
        drafts = {};
        items.forEach((it) => { drafts[it.item_id] = { mode: it.mode, value: String(it.value), enabled: it.enabled }; });
        renderItems();
        return true;
    }

    async function reload() {
        if (busy) return;
        busy = true;
        showLoader();
        await load();
        hideLoader();
        busy = false;
    }

    async function setService(s) {
        if (busy || s === service) return;
        service = s;
        $('tabAirtime').classList.toggle('active', s === 'airtime');
        $('tabElectricity').classList.toggle('active', s === 'electricity');
        await reload();
    }

    async function initialize() {
        try {
            const session = await requireSession();
            if (!session) return;
            await load();
        } catch (err) {
            toast('Something went wrong. Try again.', 'err');
        } finally {
            reveal(container, 1200);
        }
    }

    $('btnBack').addEventListener('click', () => { window.location.href = 'admin.html'; });
    $('btnRefresh').addEventListener('click', reload);
    $('tabAirtime').addEventListener('click', () => setService('airtime'));
    $('tabElectricity').addEventListener('click', () => setService('electricity'));
    $('btnApply').addEventListener('click', () => {
        const v = num($('bulkValue').value);
        const mode = $('bulkMode').value;
        if (v === null || v < 0 || (mode === 'percent' && v > 100)) {
            toast('Enter a valid profit (percent must be 0 to 100).', 'err');
            return;
        }
        items.forEach((it) => { drafts[it.item_id].mode = mode; drafts[it.item_id].value = String(v); });
        renderItems();
        toast('Profit added to every item. Press Save to keep it.', 'ok');
    });
    $('btnSaveAll').addEventListener('click', () => save(items.map((it) => it.item_id)));

    initialize();
})();
