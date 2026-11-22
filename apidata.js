import { mountShell, showLoader, hideLoader, reveal, toast, escapeHtml, money, apiPost } from './uix.js';
import { requireSession, accessToken } from './auth.js';

(function () {
    const API_ENDPOINT = '/api/apidata';
    const DAY_MS = 24 * 60 * 60 * 1000;
    const LOGOS = {
        dstv: 'https://i.imgur.com/XBe4eRi.png',
        gotv: 'https://i.imgur.com/eaTdFAU.png',
        startimes: 'https://i.imgur.com/3DbujW2.png',
        glo: 'https://i.imgur.com/JlSw9vx.png',
        '9mobile': 'https://i.imgur.com/EM2g22Z.png',
        airtel: 'https://i.imgur.com/aMgSbKX.png',
        mtn: 'https://i.imgur.com/U82jQBd.png',
        waec: 'https://i.imgur.com/jZXQymK.png',
        jamb: 'https://i.imgur.com/sVgzPfV.png',
        neco: 'https://i.imgur.com/YHwxsGM.png',
        nabteb: 'https://i.imgur.com/MU3qSXl.png'
    };
    const GROUP_LOGOS = {
        mtn_plan: LOGOS.mtn,
        itel_data: LOGOS.airtel,
        glo_data: LOGOS.glo,
        '9mobile_data': LOGOS['9mobile'],
        DSTV: LOGOS.dstv,
        GOTV: LOGOS.gotv,
        STARTIME: LOGOS.startimes,
        wec_data: LOGOS.waec,
        neco_data: LOGOS.neco,
        nabteb_data: LOGOS.nabteb,
        jamb_data: LOGOS.jamb
    };

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    const planList = $('planList');
    const netRow = $('netRow');

    let service = 'data';
    let groups = [];
    let live = {};
    let saved = {};
    let drafts = {};
    let snap = {};
    let changed = {};
    let stale = {};
    let activeGroup = null;
    let busy = false;

    function num(value) {
        const n = parseFloat(String(value === undefined || value === null ? '' : value).replace(/,/g, ''));
        return isFinite(n) ? n : null;
    }

    function readStore(key) {
        try { return window.localStorage.getItem(key); } catch (err) { return null; }
    }

    function writeStore(key, value) {
        try { window.localStorage.setItem(key, value); } catch (err) { return; }
    }

    function syncKey() { return 'apidata_sync_' + service; }
    function snapKey() { return 'apidata_snap_' + service; }

    function readSnap() {
        const raw = readStore(snapKey());
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (err) {
            return {};
        }
    }

    function writeSnap() {
        writeStore(snapKey(), JSON.stringify(snap));
    }

    function lastSync() {
        const v = parseInt(readStore(syncKey()), 10);
        return isFinite(v) && v > 0 ? v : 0;
    }

    function ageText(ms) {
        const mins = Math.floor(ms / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return mins + ' min ago';
        const hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h ' + (mins % 60) + 'm ago';
        const days = Math.floor(hours / 24);
        return days + 'd ' + (hours % 24) + 'h ago';
    }

    function renderSync() {
        const card = $('syncCard');
        const at = lastSync();
        if (!at) {
            $('syncAge').textContent = 'Not updated yet';
            $('syncNote').textContent = 'Press Update to check the provider for changes.';
            card.classList.add('due');
            return;
        }
        const age = Date.now() - at;
        $('syncAge').textContent = ageText(age);
        if (age >= DAY_MS) {
            $('syncNote').textContent = '24 hours have passed. Press Update to check for new prices.';
            card.classList.add('due');
        } else {
            $('syncNote').textContent = 'You can press Update at any time.';
            card.classList.remove('due');
        }
    }

    function markSynced() {
        writeStore(syncKey(), String(Date.now()));
        renderSync();
    }

    function entryCost(entry) {
        if (entry && typeof entry === 'object') return entry.c;
        return entry;
    }

    function analyze() {
        snap = readSnap();
        changed = {};
        stale = {};
        groups.forEach((g) => {
            const key = g.key;
            if (!snap[key] || typeof snap[key] !== 'object') snap[key] = {};
            changed[key] = {};
            stale[key] = [];
            const list = live[key] || [];
            const ids = {};
            const savedMap = saved[key] || {};
            list.forEach((p) => {
                ids[p.uid] = true;
                const onSale = savedMap[p.uid] !== undefined;
                const prev = entryCost(snap[key][p.uid]);
                if (!onSale || prev === undefined || prev === null) {
                    snap[key][p.uid] = { c: p.cost, n: p.name };
                } else if (Math.abs(Number(prev) - p.cost) > 0.001) {
                    changed[key][p.uid] = { from: Number(prev), to: p.cost };
                } else {
                    snap[key][p.uid] = { c: p.cost, n: p.name };
                }
            });
            if (list.length) {
                Object.keys(savedMap).forEach((uid) => {
                    if (!ids[uid]) {
                        const old = snap[key][uid];
                        stale[key].push({ uid: uid, price: savedMap[uid], name: old && typeof old === 'object' && old.n ? old.n : '' });
                    }
                });
            }
        });
        writeSnap();
    }

    function attention(key) {
        return Object.keys(changed[key] || {}).length + (stale[key] || []).length;
    }

    function renderAlert() {
        let total = 0;
        groups.forEach((g) => { total += attention(g.key); });
        const box = $('alertStrip');
        if (!total) {
            box.classList.add('hidden');
            box.innerHTML = '';
            return;
        }
        box.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><span>' + total + (total === 1 ? ' plan needs' : ' plans need') + ' your attention. Open the marked networks and update them.</span>';
        box.classList.remove('hidden');
    }

    function ack(uids) {
        uids.forEach((uid) => {
            const p = (live[activeGroup] || []).find((x) => x.uid === uid);
            if (p) snap[activeGroup][uid] = { c: p.cost, n: p.name };
            if (changed[activeGroup]) delete changed[activeGroup][uid];
        });
        writeSnap();
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

    function buildDrafts() {
        drafts = {};
        groups.forEach((g) => {
            drafts[g.key] = {};
            (live[g.key] || []).forEach((p) => {
                const price = saved[g.key] ? saved[g.key][p.uid] : undefined;
                drafts[g.key][p.uid] = price !== undefined ? (price - p.cost).toFixed(2) : '';
            });
        });
    }

    function renderGroups() {
        netRow.innerHTML = '';
        groups.forEach((g) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'net-chip' + (g.key === activeGroup ? ' active' : '');
            const n = attention(g.key);
            chip.innerHTML = '<img src="' + (GROUP_LOGOS[g.key] || '') + '" alt="">' + escapeHtml(g.label) + (n ? '<span class="dot">' + n + '</span>' : '');
            chip.addEventListener('click', () => { activeGroup = g.key; renderGroups(); renderItems(); });
            netRow.appendChild(chip);
        });
        let total = 0;
        groups.forEach((g) => { total += (live[g.key] || []).length; });
        $('planCount').textContent = String(total);
    }

    function renderStale() {
        const list = stale[activeGroup] || [];
        if (!list.length) return;
        const head = document.createElement('div');
        head.className = 'form-card stale';
        head.innerHTML =
            '<div class="stale-head"><h4><i class="fa-solid fa-ban"></i> Not working at provider (' + list.length + ')</h4>' +
            '<button type="button" class="btn-small danger js-remove-all">Remove all</button></div>' +
            '<p class="stale-note">These plans are no longer returned by the provider. Customers must not buy them. Remove them from sale.</p>';
        head.querySelector('.js-remove-all').addEventListener('click', () => removeStale(list.map((s) => s.uid)));
        planList.appendChild(head);
        list.forEach((s) => {
            const card = document.createElement('div');
            card.className = 'form-card stale';
            card.innerHTML =
                '<div class="tx-meta"><span class="tx-title">' + escapeHtml(s.name || ('Plan ' + s.uid)) + '</span>' +
                '<span class="flag flag-gone"><i class="fa-solid fa-circle-xmark"></i> Removed by provider</span></div>' +
                '<div class="detail-rows">' +
                '<div class="detail-row"><span class="detail-row-label">Plan ID</span><span class="detail-row-val">' + escapeHtml(s.uid) + '</span></div>' +
                '<div class="detail-row"><span class="detail-row-label">Selling price</span><span class="detail-row-val">₦' + escapeHtml(money(s.price)) + '</span></div></div>' +
                '<button type="button" class="btn-small danger js-remove">Remove from sale</button>';
            card.querySelector('.js-remove').addEventListener('click', () => removeStale([s.uid]));
            planList.appendChild(card);
        });
    }

    function renderItems() {
        planList.innerHTML = '';
        renderStale();
        const flagged = changed[activeGroup] || {};
        const list = (live[activeGroup] || []).slice().sort((a, b) => {
            const fa = flagged[a.uid] ? 0 : 1;
            const fb = flagged[b.uid] ? 0 : 1;
            return fa - fb || a.cost - b.cost;
        });
        if (!list.length) {
            planList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-xmark empty-icon"></i><h3 class="empty-title">Nothing found</h3><p class="empty-desc">The provider returned no plans for this section. Pull to refresh or try another network.</p></div>';
            return;
        }
        list.forEach((p) => {
            const savedPrice = saved[activeGroup] ? saved[activeGroup][p.uid] : undefined;
            const change = flagged[p.uid];
            let status = '<span class="muted">Not on sale</span>';
            if (savedPrice !== undefined) {
                status = savedPrice < p.cost
                    ? '<span class="warn">On sale ₦' + escapeHtml(money(savedPrice)) + ' (below cost)</span>'
                    : '<span class="good">On sale ₦' + escapeHtml(money(savedPrice)) + '</span>';
            }
            const flag = change
                ? '<span class="flag flag-change"><i class="fa-solid fa-arrow-trend-' + (change.to > change.from ? 'up' : 'down') + '"></i> Cost changed ₦' + escapeHtml(money(change.from)) + ' → ₦' + escapeHtml(money(change.to)) + '</span>'
                : '';
            const card = document.createElement('div');
            card.className = 'form-card' + (change ? ' changed' : '');
            card.innerHTML =
                '<div class="tx-meta"><span class="tx-title">' + escapeHtml(p.name) + '</span><span class="tx-date">' + escapeHtml(p.sub) + '</span>' + flag + '</div>' +
                '<div class="detail-rows">' +
                '<div class="detail-row"><span class="detail-row-label">Provider cost</span><span class="detail-row-val">₦' + escapeHtml(money(p.cost)) + '</span></div>' +
                '<div class="detail-row"><span class="detail-row-label">Selling price</span><span class="detail-row-val js-price">-</span></div>' +
                '<div class="detail-row"><span class="detail-row-label">Status</span><span class="detail-row-val">' + status + '</span></div></div>' +
                '<div class="bulk-row"><input class="input js-markup" type="number" inputmode="decimal" min="0" step="1" placeholder="Profit in ₦" value="' + escapeHtml(drafts[activeGroup][p.uid]) + '">' +
                '<button type="button" class="btn-small js-save">Save</button></div>';
            const input = card.querySelector('.js-markup');
            const priceEl = card.querySelector('.js-price');
            const refresh = () => {
                const m = num(input.value);
                priceEl.textContent = m !== null && m >= 0 ? '₦' + money(p.cost + m) : '-';
            };
            input.addEventListener('input', () => { drafts[activeGroup][p.uid] = input.value; refresh(); });
            card.querySelector('.js-save').addEventListener('click', () => save([p.uid]));
            refresh();
            planList.appendChild(card);
        });
    }

    async function save(uids) {
        if (busy) return;
        const items = [];
        uids.forEach((uid) => {
            const m = num(drafts[activeGroup][uid]);
            if (m !== null && m >= 0) items.push({ uid: uid, markup: m });
        });
        if (!items.length) {
            toast('Enter a profit amount of zero or more.', 'err');
            return;
        }
        busy = true;
        showLoader();
        const result = await call({ action: 'save', group: activeGroup, items: items });
        hideLoader();
        busy = false;
        if (result && result.success) {
            saved[activeGroup] = Object.assign({}, saved[activeGroup], result.prices);
            ack(items.map((i) => i.uid));
            renderGroups();
            renderItems();
            renderAlert();
            toast(result.message || 'Prices saved.', 'ok');
        } else {
            toast((result && result.message) || 'Could not save prices. Try again.', 'err');
        }
    }

    async function removeStale(uids) {
        if (busy || !uids.length) return;
        busy = true;
        showLoader();
        const result = await call({ action: 'remove', group: activeGroup, uids: uids });
        hideLoader();
        busy = false;
        if (result && result.success) {
            uids.forEach((uid) => {
                if (saved[activeGroup]) delete saved[activeGroup][uid];
                if (snap[activeGroup]) delete snap[activeGroup][uid];
            });
            stale[activeGroup] = (stale[activeGroup] || []).filter((s) => uids.indexOf(s.uid) === -1);
            writeSnap();
            renderGroups();
            renderItems();
            renderAlert();
            toast(result.message || 'Removed from sale.', 'ok');
        } else {
            toast((result && result.message) || 'Could not remove. Try again.', 'err');
        }
    }

    async function load(manual) {
        const result = await call({ action: 'load' });
        if (!result || !result.success) {
            toast((result && result.message) || 'Could not load provider data.', 'err');
            return false;
        }
        if (result.warning) toast('Warning: ' + result.warning, 'err');
        if (result.hidden_now) toast(result.hidden_now + ' plan(s) removed by the provider were hidden from customers.', 'ok');
        const previous = activeGroup;
        groups = result.groups || [];
        live = result.live || {};
        saved = result.saved || {};
        activeGroup = groups.some((g) => g.key === previous) ? previous : (groups.length ? groups[0].key : null);
        buildDrafts();
        analyze();
        renderGroups();
        renderItems();
        renderAlert();
        if (manual) markSynced();
        return true;
    }

    async function reload(manual) {
        if (busy) return;
        busy = true;
        showLoader();
        const ok = await load(manual === true);
        hideLoader();
        busy = false;
        if (manual === true && ok) toast('Plans updated from provider.', 'ok');
    }

    async function setService(s) {
        if (busy || s === service) return;
        service = s;
        $('tabData').classList.toggle('active', s === 'data');
        $('tabCable').classList.toggle('active', s === 'cable');
        $('tabExam').classList.toggle('active', s === 'exam');
        activeGroup = null;
        renderSync();
        await reload(false);
    }

    async function initialize() {
        try {
            const session = await requireSession();
            if (!session) return;
            renderSync();
            await load(false);
        } catch (err) {
            toast('Something went wrong. Try again.', 'err');
        } finally {
            reveal(container, 1200);
        }
    }

    $('btnBack').addEventListener('click', () => { window.location.href = 'admin.html'; });
    $('tabData').addEventListener('click', () => setService('data'));
    $('tabCable').addEventListener('click', () => setService('cable'));
    $('tabExam').addEventListener('click', () => setService('exam'));
    $('btnRefresh').addEventListener('click', () => reload(true));
    $('btnSync').addEventListener('click', () => reload(true));
    $('btnDiagnose').addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        showLoader();
        const result = await call({ action: 'diagnose' });
        hideLoader();
        busy = false;
        const box = $('diagBox');
        box.textContent = JSON.stringify(result, null, 2);
        box.classList.remove('hidden');
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('btnApply').addEventListener('click', () => {
        const m = num($('bulkInput').value);
        if (m === null || m < 0) {
            toast('Enter a valid amount.', 'err');
            return;
        }
        (live[activeGroup] || []).forEach((p) => { drafts[activeGroup][p.uid] = String(m); });
        renderItems();
        toast('Profit added to every plan. Press Save to keep it.', 'ok');
    });
    $('btnSaveAll').addEventListener('click', () => save((live[activeGroup] || []).map((p) => p.uid)));

    setInterval(renderSync, 30000);

    initialize();
})();
