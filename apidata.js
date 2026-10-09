import { mountShell, showLoader, hideLoader, reveal, toast, escapeHtml, money, apiPost } from './uix.js';
import { requireSession, accessToken } from './auth.js';

(function () {
    const API_ENDPOINT = '/api/apidata';
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
    let activeGroup = null;
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
            chip.innerHTML = '<img src="' + (GROUP_LOGOS[g.key] || '') + '" alt="">' + escapeHtml(g.label);
            chip.addEventListener('click', () => { activeGroup = g.key; renderGroups(); renderItems(); });
            netRow.appendChild(chip);
        });
        let total = 0;
        groups.forEach((g) => { total += (live[g.key] || []).length; });
        $('planCount').textContent = String(total);
    }

    function renderItems() {
        planList.innerHTML = '';
        const list = (live[activeGroup] || []).slice().sort((a, b) => a.cost - b.cost);
        if (!list.length) {
            planList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-xmark empty-icon"></i><h3 class="empty-title">Nothing found</h3><p class="empty-desc">The provider returned no plans for this section. Pull to refresh or try another network.</p></div>';
            return;
        }
        list.forEach((p) => {
            const savedPrice = saved[activeGroup] ? saved[activeGroup][p.uid] : undefined;
            let status = '<span class="muted">Not on sale</span>';
            if (savedPrice !== undefined) {
                status = savedPrice < p.cost
                    ? '<span class="warn">On sale ₦' + escapeHtml(money(savedPrice)) + ' (below cost)</span>'
                    : '<span class="good">On sale ₦' + escapeHtml(money(savedPrice)) + '</span>';
            }
            const card = document.createElement('div');
            card.className = 'form-card';
            card.innerHTML =
                '<div class="tx-meta"><span class="tx-title">' + escapeHtml(p.name) + '</span><span class="tx-date">' + escapeHtml(p.sub) + '</span></div>' +
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
            renderItems();
            toast(result.message || 'Prices saved.', 'ok');
        } else {
            toast((result && result.message) || 'Could not save prices. Try again.', 'err');
        }
    }

    async function load() {
        const result = await call({ action: 'load' });
        if (!result || !result.success) {
            toast((result && result.message) || 'Could not load provider data.', 'err');
            return false;
        }
        groups = result.groups || [];
        live = result.live || {};
        saved = result.saved || {};
        activeGroup = groups.length ? groups[0].key : null;
        buildDrafts();
        renderGroups();
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
        $('tabData').classList.toggle('active', s === 'data');
        $('tabCable').classList.toggle('active', s === 'cable');
        $('tabExam').classList.toggle('active', s === 'exam');
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
    $('tabData').addEventListener('click', () => setService('data'));
    $('tabCable').addEventListener('click', () => setService('cable'));
    $('tabExam').addEventListener('click', () => setService('exam'));
    $('btnRefresh').addEventListener('click', reload);
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

    initialize();
})();

