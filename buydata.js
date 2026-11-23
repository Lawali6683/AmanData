import { supabase } from './supabase.js';
import { SESSION_KEY, sessionId, mountShell, showLoader, hideLoader, toast, pinBoxes, escapeHtml, money } from './ui.js';

const LOGOS = {
    dstv: 'https://i.imgur.com/XBe4eRi.png',
    gotv: 'https://i.imgur.com/eaTdFAU.png',
    startimes: 'https://i.imgur.com/756Scuc.png',
    glo: 'https://i.imgur.com/gEvagGA.png',
    '9mobile': 'https://i.imgur.com/bMOx9Q3.png',
    airtel: 'https://i.imgur.com/fEWKTML.png',
    mtn: 'https://i.imgur.com/U82jQBd.png',
    waec: 'https://i.imgur.com/jZXQymK.png',
    jamb: 'https://i.imgur.com/aZ5zttY.png',
    neco: 'https://i.imgur.com/qDOjXow.png',
    nabteb: 'https://i.imgur.com/MU3qSXl.png',
    nepa: 'https://i.imgur.com/5BlVKuy.png'
};

(function () {
    const API_ENDPOINT = '/api/buydata';
    const EASY_ENDPOINT = '/api/simbuy';
    const REQUEST_TIMEOUT_MS = 60000;
    const STALE_AFTER_MS = 60000;
    const SIM_NETWORKS = { mtn_plan: 'mtn', itel_data: 'airtel', glo_data: 'glo', '9mobile_data': '9mobile' };
    const NETWORKS = [
        { key: 'mtn_plan', name: 'MTN', logo: LOGOS.mtn },
        { key: 'itel_data', name: 'AIRTEL', logo: LOGOS.airtel },
        { key: 'glo_data', name: 'GLO', logo: LOGOS.glo },
        { key: '9mobile_data', name: '9MOBILE', logo: LOGOS['9mobile'] }
    ];
    const TYPE_ORDER = ['sme', 'gifting', 'coop', 'smart'];
    const TYPE_ICONS = { sme: 'fa-bolt', gifting: 'fa-gift', coop: 'fa-users', smart: 'fa-microchip' };
    const BUCKET_ICONS = { daily: 'fa-sun', weekly: 'fa-calendar-week', monthly: 'fa-calendar-days', long: 'fa-hourglass-half', other: 'fa-clock' };
    const BUCKET_HINTS = { daily: '1 to 2 days', weekly: '3 to 14 days', monthly: '15 to 31 days', long: 'More than 31 days', other: 'Other validity' };
    const BUCKETS = [
        { key: 'daily', label: 'Daily' },
        { key: 'weekly', label: 'Weekly' },
        { key: 'monthly', label: 'Monthly' },
        { key: 'long', label: 'Long term' },
        { key: 'other', label: 'Other' }
    ];

    window.addEventListener('pageshow', (e) => { if (e.persisted) window.location.reload(); });

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const appContainer = $('appContainer');
    const planList = $('planList');
    const netRow = $('netRow');
    const tabsBox = resolveTabsBox();
    const summaryBox = resolveSummaryBox();
    const buyForm = $('buyForm');
    const phoneInput = $('phone');
    const buyBtn = $('btnBuy');
    const pin = pinBoxes($('pinRow'));
    const sheet = buildSheet();

    let uuid = null;
    let balance = 0;
    let sources = { easy: {}, simple: {} };
    let extraTabs = [];
    let activeTab = 'easy';
    let activeNet = null;
    let activeType = null;
    let activeBucket = null;
    let sheetStep = null;
    let selectedPlan = null;
    let attemptId = null;
    let loadFailed = false;
    let busy = false;
    let refreshing = false;
    let lastLoaded = Date.now();

    function resolveTabsBox() {
        let el = $('filterTabs');
        if (el) return el;
        el = document.createElement('section');
        el.className = 'bd-tabs';
        el.id = 'filterTabs';
        netRow.parentNode.insertBefore(el, netRow);
        return el;
    }

    function resolveSummaryBox() {
        let el = $('bdSummary');
        if (el) return el;
        el = document.createElement('div');
        el.className = 'bd-summary';
        el.id = 'bdSummary';
        el.hidden = true;
        planList.parentNode.insertBefore(el, planList);
        return el;
    }

    function buildSheet() {
        const overlay = document.createElement('div');
        overlay.className = 'bd-sheet-overlay';
        overlay.innerHTML =
            '<div class="bd-sheet" role="dialog" aria-modal="true">' +
            '<div class="bd-sheet-handle"></div>' +
            '<div class="bd-sheet-head">' +
            '<button type="button" class="bd-sheet-btn js-back" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button>' +
            '<div class="bd-sheet-titles"><span class="bd-sheet-step"></span><h3 class="bd-sheet-title"></h3></div>' +
            '<button type="button" class="bd-sheet-btn js-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
            '</div><div class="bd-sheet-list"></div></div>';
        document.body.appendChild(overlay);
        return {
            overlay: overlay,
            back: overlay.querySelector('.js-back'),
            close: overlay.querySelector('.js-close'),
            step: overlay.querySelector('.bd-sheet-step'),
            title: overlay.querySelector('.bd-sheet-title'),
            list: overlay.querySelector('.bd-sheet-list')
        };
    }

    function setVisible(node, visible) {
        const box = node.closest('.bd-block') || node;
        box.hidden = !visible;
    }

    function newToken() {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    function fmtPrice(value) {
        return '₦' + money(value).replace(/\.00$/, '');
    }

    function dayCount(text) {
        const t = String(text || '').toLowerCase();
        if (!t) return null;
        const m = t.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|nights?|days?|weeks?|wks?|months?|years?|yrs?)/);
        if (m) {
            const n = parseFloat(m[1]);
            const u = m[2];
            if (/^(hour|hr|night)/.test(u)) return Math.min(n, 1);
            if (/^(week|wk)/.test(u)) return n * 7;
            if (/^month/.test(u)) return n * 30;
            if (/^(year|yr)/.test(u)) return n * 365;
            return n;
        }
        if (/year/.test(t)) return 365;
        if (/month/.test(t)) return 30;
        if (/week/.test(t)) return 7;
        if (/night|hour|daily|day/.test(t)) return 1;
        return null;
    }

    function bucketOf(text) {
        const d = dayCount(text);
        if (d === null) return 'other';
        if (d <= 2) return 'daily';
        if (d <= 14) return 'weekly';
        if (d <= 31) return 'monthly';
        return 'long';
    }

    function typeOf(raw) {
        const t = String(raw || '').trim().toUpperCase();
        if (!t) return { key: 'other', label: 'Other' };
        if (/COOP|CORPORATE/.test(t)) return { key: 'coop', label: 'Cooperate' };
        if (/SME/.test(t)) return { key: 'sme', label: 'SME' };
        if (/SMART/.test(t)) return { key: 'smart', label: 'Smart' };
        if (/GIFT/.test(t)) return { key: 'gifting', label: 'Gifting' };
        return { key: t.toLowerCase(), label: t.charAt(0) + t.slice(1).toLowerCase() };
    }

    function enrich(list) {
        return list.map((p) => ({ plan: p, type: typeOf(p.plan_type), bucket: bucketOf(p.plan_day) }));
    }

    function orderedTypes(items) {
        const map = {};
        items.forEach((i) => {
            if (!map[i.type.key]) map[i.type.key] = { key: i.type.key, label: i.type.label, count: 0 };
            map[i.type.key].count += 1;
        });
        const rank = (k) => { const at = TYPE_ORDER.indexOf(k); return at === -1 ? 99 : at; };
        return Object.keys(map).map((k) => map[k]).sort((a, b) => (rank(a.key) - rank(b.key)) || a.label.localeCompare(b.label));
    }

    function orderedBuckets(items) {
        const counts = {};
        items.forEach((i) => { counts[i.bucket] = (counts[i.bucket] || 0) + 1; });
        return BUCKETS.filter((b) => counts[b.key]).map((b) => ({ key: b.key, label: b.label, count: counts[b.key] }));
    }

    async function postJson(url, payload, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            let data = null;
            try { data = await res.json(); } catch (err) { data = null; }
            if (!data || typeof data !== 'object') {
                return { success: false, unsure: true, message: 'Network issue. Check your history before you try again.' };
            }
            return data;
        } catch (err) {
            return { success: false, unsure: true, message: 'Network issue. Check your history before you try again.' };
        } finally {
            clearTimeout(timer);
        }
    }

    async function loadCatalog() {
        try {
            const res = await fetch('/api/catalog?type=data&t=' + Date.now(), { cache: 'no-store' });
            const data = await res.json();
            if (!data || !data.success) throw new Error('catalog');
            return data;
        } catch (err) {
            return null;
        }
    }

    async function loadExtras() {
        try {
            const [srcRes, planRes] = await Promise.all([
                supabase.from('data_sources').select('source_key,label,icon,endpoint,sort_order').eq('active', true).order('sort_order', { ascending: true }),
                supabase.from('data_plans').select('source_key,network_key,plan_id,plan_name,plan_type,plan_day,price').eq('active', true)
            ]);
            if (srcRes.error || planRes.error) return [];
            const grouped = {};
            (planRes.data || []).forEach((p) => {
                if (!grouped[p.source_key]) grouped[p.source_key] = {};
                if (!grouped[p.source_key][p.network_key]) grouped[p.source_key][p.network_key] = [];
                grouped[p.source_key][p.network_key].push(p);
            });
            return (srcRes.data || [])
                .filter((s) => grouped[s.source_key] && s.endpoint)
                .map((s) => ({ key: s.source_key, label: s.label, icon: s.icon || 'fa-wifi', endpoint: s.endpoint, plans: grouped[s.source_key] }));
        } catch (err) {
            return [];
        }
    }

    async function loadProfile() {
        try {
            const { data, error } = await supabase.from('user_profiles').select('user_data').eq('id', uuid);
            if (error) throw error;
            const ud = data && data[0] && data[0].user_data ? data[0].user_data : {};
            $('userName').textContent = ud.full_name || 'User';
            balance = parseFloat(String(ud.user_balance || 0).replace(/,/g, '')) || 0;
        } catch (err) {
            toast('We could not load your account. Check your network and try again.', 'err');
        }
        $('sumBalance').textContent = money(balance);
    }

    async function fetchSources() {
        const [catalog, extras] = await Promise.all([loadCatalog(), loadExtras()]);
        const built = { easy: {}, simple: {} };
        if (catalog) {
            built.easy = Object.assign({}, catalog.easy || {});
            built.simple = Object.assign({}, catalog.simple || {});
            if (catalog.online) {
                Object.keys(built.easy).forEach((k) => { if (!catalog.online[SIM_NETWORKS[k]]) delete built.easy[k]; });
            }
        }
        extras.forEach((t) => { built[t.key] = t.plans; });
        return { sources: built, extras: extras, failed: !catalog && extras.length === 0 };
    }

    function applyFresh(result) {
        sources = result.sources;
        extraTabs = result.extras;
        loadFailed = result.failed;
        lastLoaded = Date.now();
    }

    function endpointFor(tab) {
        if (tab === 'easy') return EASY_ENDPOINT;
        if (tab === 'simple') return API_ENDPOINT;
        const found = extraTabs.find((t) => t.key === tab);
        return found ? found.endpoint : API_ENDPOINT;
    }

    function netPlans(tab, net) {
        const map = sources[tab];
        return map && map[net] && map[net].length ? map[net] : [];
    }

    function hasPlans(tab) {
        return NETWORKS.some((n) => netPlans(tab, n.key).length);
    }

    function firstNet(tab) {
        return NETWORKS.find((n) => netPlans(tab, n.key).length) || null;
    }

    function availableTabs() {
        const all = [
            { key: 'easy', label: 'Easy Power Plan', icon: 'fa-bolt' },
            { key: 'simple', label: 'Simple Plan', icon: 'fa-layer-group' }
        ].concat(extraTabs.map((t) => ({ key: t.key, label: t.label, icon: t.icon })));
        return all;
    }

    function hasAnyPlans() {
        return Object.keys(sources).some((k) => hasPlans(k));
    }

    function findPlan(tab, net, id) {
        return netPlans(tab, net).find((p) => String(p.plan_id) === String(id)) || null;
    }

    function itemsOfNet() {
        return activeNet ? enrich(netPlans(activeTab, activeNet)) : [];
    }

    function bucketsOfType(typeKey) {
        return orderedBuckets(itemsOfNet().filter((i) => i.type.key === typeKey));
    }

    function syncFilters() {
        if (!activeNet) {
            activeType = null;
            activeBucket = null;
            return;
        }
        const types = orderedTypes(itemsOfNet());
        if (!types.some((t) => t.key === activeType)) {
            activeType = null;
            activeBucket = null;
        }
        if (!activeType && types.length === 1) activeType = types[0].key;
        if (!activeType) return;
        const buckets = bucketsOfType(activeType);
        if (!buckets.some((b) => b.key === activeBucket)) activeBucket = null;
        if (!activeBucket && buckets.length === 1) activeBucket = buckets[0].key;
    }

    function isComplete() {
        return Boolean(activeNet && activeType && activeBucket);
    }

    function clearSelection() {
        selectedPlan = null;
        attemptId = null;
        buyForm.classList.add('hidden');
    }

    function renderTabs() {
        tabsBox.innerHTML = '';
        const tabs = availableTabs();
        tabsBox.hidden = false;
        tabs.forEach((t) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bd-tab' + (t.key === activeTab ? ' active' : '');
            btn.innerHTML = '<i class="fa-solid ' + escapeHtml(t.icon) + '"></i><span>' + escapeHtml(t.label) + '</span>';
            btn.addEventListener('click', () => setTab(t.key));
            tabsBox.appendChild(btn);
        });
        const current = tabsBox.querySelector('.bd-tab.active');
        if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest', inline: 'center' });
    }

    function renderNets() {
        netRow.innerHTML = '';
        const available = NETWORKS.filter((n) => netPlans(activeTab, n.key).length);
        setVisible(netRow, available.length > 0);
        available.forEach((n) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bd-net' + (n.key === activeNet ? ' active' : '');
            btn.setAttribute('aria-label', n.name);
            btn.innerHTML = '<img src="' + n.logo + '" alt="' + escapeHtml(n.name) + '">';
            btn.addEventListener('click', () => pickNetwork(n.key));
            netRow.appendChild(btn);
        });
    }

    function renderSummary() {
        if (!isComplete()) {
            summaryBox.hidden = true;
            summaryBox.innerHTML = '';
            return;
        }
        const net = NETWORKS.find((n) => n.key === activeNet);
        const type = orderedTypes(itemsOfNet()).find((t) => t.key === activeType);
        const bucket = BUCKETS.find((b) => b.key === activeBucket);
        const canChange = orderedTypes(itemsOfNet()).length > 1 || bucketsOfType(activeType).length > 1;
        summaryBox.innerHTML =
            '<div class="bd-chips">' +
            '<span class="bd-chip"><img src="' + net.logo + '" alt="">' + escapeHtml(net.name) + '</span>' +
            '<span class="bd-chip">' + escapeHtml(type ? type.label : '') + '</span>' +
            '<span class="bd-chip">' + escapeHtml(bucket ? bucket.label : '') + '</span></div>' +
            (canChange ? '<button type="button" class="bd-change">Change</button>' : '');
        summaryBox.hidden = false;
        const change = summaryBox.querySelector('.bd-change');
        if (change) change.addEventListener('click', () => openSheet());
    }

    function renderEmpty(icon, title, desc, actionLabel, action) {
        planList.innerHTML = '<div class="empty-state"><i class="fa-solid ' + icon + ' empty-icon"></i>' +
            '<h3 class="empty-title">' + escapeHtml(title) + '</h3><p class="empty-desc">' + escapeHtml(desc) + '</p>' +
            (actionLabel ? '<button type="button" class="bd-prompt-btn">' + escapeHtml(actionLabel) + '</button>' : '') + '</div>';
        if (actionLabel) planList.querySelector('.bd-prompt-btn').addEventListener('click', action);
    }

    function renderPlans() {
        planList.innerHTML = '';
        if (!firstNet(activeTab)) {
            if (loadFailed) {
                renderEmpty('fa-triangle-exclamation', 'Plans not loaded', 'Network issue. Check your network and open this page again.');
            } else if (!hasAnyPlans()) {
                renderEmpty('fa-box-open', 'No plans now', 'No data plan is available now. Please check again later.');
            } else {
                renderEmpty('fa-circle-xmark', 'Not available', 'This plan type is not available now. Please try another plan.');
            }
            return;
        }
        if (!activeNet) {
            renderEmpty('fa-hand-pointer', 'Choose a network', 'Tap a network above to see the plans.');
            return;
        }
        if (!isComplete()) {
            renderEmpty('fa-list-check', 'Choose your plan', 'Tap the button to pick the plan type and validity.', 'Choose plan', () => openSheet());
            return;
        }
        const items = itemsOfNet()
            .filter((i) => i.type.key === activeType && i.bucket === activeBucket)
            .sort((a, b) => Number(a.plan.price) - Number(b.plan.price));
        if (!items.length) {
            renderEmpty('fa-circle-xmark', 'Not available', 'This plan type is not available now. Try another one.');
            return;
        }
        items.forEach((item) => {
            const p = item.plan;
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'bd-plan' + (selectedPlan && String(selectedPlan.plan_id) === String(p.plan_id) ? ' selected' : '');
            card.innerHTML =
                '<span class="bd-plan-size">' + escapeHtml(p.plan_name) + '</span>' +
                '<span class="bd-plan-valid">' + escapeHtml(p.plan_day || item.type.label) + '</span>' +
                '<span class="bd-plan-price">' + escapeHtml(fmtPrice(p.price)) + '</span>';
            card.addEventListener('click', () => selectPlan(p));
            planList.appendChild(card);
        });
    }

    function renderAll() {
        renderTabs();
        renderNets();
        renderSummary();
        renderPlans();
    }

    function optionButton(icon, title, meta, count, active, onPick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bd-opt' + (active ? ' active' : '');
        btn.innerHTML =
            '<span class="bd-opt-icon"><i class="fa-solid ' + icon + '"></i></span>' +
            '<span class="bd-opt-text"><span class="bd-opt-title">' + escapeHtml(title) + '</span><span class="bd-opt-meta">' + escapeHtml(meta) + '</span></span>' +
            '<span class="bd-opt-end"><span class="bd-opt-count">' + count + '</span><i class="fa-solid fa-chevron-right"></i></span>';
        btn.addEventListener('click', onPick);
        return btn;
    }

    function renderSheet() {
        if (!sheetStep || !activeNet) {
            closeSheet();
            return;
        }
        const net = NETWORKS.find((n) => n.key === activeNet);
        const types = orderedTypes(itemsOfNet());
        const multi = types.length > 1;
        sheet.list.innerHTML = '';
        if (sheetStep === 'type') {
            sheet.step.textContent = net.name + ' · Step 1 of 2';
            sheet.title.textContent = 'Choose plan type';
            sheet.back.hidden = true;
            types.forEach((t) => {
                sheet.list.appendChild(optionButton(TYPE_ICONS[t.key] || 'fa-sim-card', t.label, t.count + (t.count === 1 ? ' plan' : ' plans'), t.count, t.key === activeType, () => pickType(t.key)));
            });
            return;
        }
        const buckets = bucketsOfType(activeType);
        sheet.step.textContent = multi ? net.name + ' · Step 2 of 2' : net.name;
        sheet.title.textContent = 'Choose validity';
        sheet.back.hidden = !multi;
        buckets.forEach((b) => {
            sheet.list.appendChild(optionButton(BUCKET_ICONS[b.key] || 'fa-clock', b.label, BUCKET_HINTS[b.key] || '', b.count, b.key === activeBucket, () => pickBucket(b.key)));
        });
    }

    function openSheet() {
        syncFilters();
        if (!activeNet) return;
        const types = orderedTypes(itemsOfNet());
        let step = null;
        if (types.length > 1) step = 'type';
        else if (activeType && bucketsOfType(activeType).length > 1) step = 'bucket';
        if (!step) return;
        sheetStep = step;
        renderSheet();
        sheet.overlay.classList.add('open');
        document.body.classList.add('bd-lock');
    }

    function closeSheet() {
        sheetStep = null;
        sheet.overlay.classList.remove('open');
        document.body.classList.remove('bd-lock');
    }

    function scrollToPlans() {
        setTimeout(() => {
            const target = summaryBox.hidden ? planList : summaryBox;
            if (target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 180);
    }

    function finishPick() {
        closeSheet();
        renderAll();
        scrollToPlans();
    }

    function pickNetwork(key) {
        if (key === activeNet) {
            openSheet();
            return;
        }
        activeNet = key;
        activeType = null;
        activeBucket = null;
        clearSelection();
        syncFilters();
        renderAll();
        if (isComplete()) scrollToPlans();
        else openSheet();
    }

    function pickType(key) {
        activeType = key;
        activeBucket = null;
        clearSelection();
        syncFilters();
        if (activeBucket) {
            finishPick();
            return;
        }
        sheetStep = 'bucket';
        renderSheet();
        renderAll();
    }

    function pickBucket(key) {
        activeBucket = key;
        clearSelection();
        finishPick();
    }

    function reconcile() {
        const tabs = availableTabs();
        if (!tabs.some((t) => t.key === activeTab)) activeTab = tabs[0] ? tabs[0].key : 'easy';
        const available = NETWORKS.filter((n) => netPlans(activeTab, n.key).length);
        if (activeNet && !available.some((n) => n.key === activeNet)) activeNet = null;
        if (!activeNet && available.length === 1) activeNet = available[0].key;
        syncFilters();
        renderAll();
        if (sheetStep) renderSheet();
    }

    function selectPlan(p) {
        selectedPlan = p;
        attemptId = null;
        const net = NETWORKS.find((n) => n.key === activeNet);
        const typeEl = $('fType');
        $('fNetwork').textContent = net ? net.name : '-';
        if (typeEl) typeEl.textContent = typeOf(p.plan_type).label;
        $('fPlan').textContent = p.plan_name;
        $('fDay').textContent = p.plan_day || '-';
        $('fPrice').textContent = fmtPrice(p.price);
        buyForm.classList.remove('hidden');
        renderPlans();
        checkForm();
    }

    function setTab(tab) {
        activeTab = tab;
        activeNet = null;
        activeType = null;
        activeBucket = null;
        clearSelection();
        closeSheet();
        reconcile();
    }

    function phoneValid() {
        return /^(0\d{10}|234\d{10})$/.test(phoneInput.value);
    }

    function checkForm() {
        phoneInput.classList.toggle('ok', phoneValid());
        phoneInput.classList.toggle('bad', phoneInput.value.length > 0 && !phoneValid() && phoneInput.value.length >= 11);
        buyBtn.hidden = !(selectedPlan && phoneValid() && pin.valid());
    }

    function localizeMessage(raw) {
        const m = String(raw || '').toLowerCase();
        if (!m) return '';
        if (/pin/.test(m)) return 'Your PIN is wrong. Please try again.';
        if (/insufficient|balance|fund/.test(m)) return 'Your wallet money is not enough. Please add money to your wallet.';
        if (/too many|limit|duplicate|already/.test(m)) return 'This request was already sent. Wait a little and check your history.';
        if (/session|sign in|log ?in|password/.test(m)) return 'Please log in again and try.';
        if (/phone|number/.test(m)) return 'The phone number is not correct. Please check it.';
        return '';
    }

    function failureMessage(result) {
        const raw = String(result && result.message ? result.message : '').trim();
        if (result && result.unsure) return 'Network issue. Check your history before you try again.';
        if (result && result.pending) return 'Your purchase is still processing. Check your history before you try again.';
        const known = localizeMessage(raw);
        if (known) return known;
        const net = NETWORKS.find((n) => n.key === activeNet);
        return 'This plan is not working for ' + phoneInput.value + (net ? ' (' + net.name + ')' : '') + ' now. Please try another plan.';
    }

    async function submit() {
        if (busy || !selectedPlan) return;
        if (Number(selectedPlan.price) > balance) {
            toast('Your wallet money is not enough. Please add money to your wallet.', 'err');
            return;
        }
        busy = true;
        buyBtn.disabled = true;
        showLoader();
        if (!attemptId) attemptId = newToken();

        let result = null;
        let outdated = false;
        try {
            const fresh = await fetchSources();
            if (!fresh.failed) {
                applyFresh(fresh);
                const match = findPlan(activeTab, activeNet, selectedPlan.plan_id);
                if (!match || Number(match.price) !== Number(selectedPlan.price)) outdated = true;
                else selectedPlan = match;
            }
            if (!outdated) {
                result = await postJson(endpointFor(activeTab), {
                    uuid: uuid,
                    source: activeTab,
                    network_key: activeNet,
                    plan_id: String(selectedPlan.plan_id),
                    phone: phoneInput.value,
                    pin: pin.value(),
                    request_id: attemptId
                }, REQUEST_TIMEOUT_MS);
            }
        } finally {
            hideLoader();
            busy = false;
            buyBtn.disabled = false;
        }

        if (outdated) {
            clearSelection();
            reconcile();
            checkForm();
            toast('This plan was just updated. Please choose a plan again.', 'err');
            return;
        }

        if (!result.unsure && !result.pending) attemptId = null;

        if (result.balance !== undefined && result.balance !== null) {
            balance = Number(result.balance) || 0;
            $('sumBalance').textContent = money(balance);
        }

        if (result.success) {
            toast('Purchase successful.', 'ok');
            phoneInput.value = '';
            pin.clear();
            clearSelection();
            renderPlans();
            checkForm();
            return;
        }

        toast(failureMessage(result), 'err');
    }

    async function refreshQuiet() {
        if (busy || refreshing || !uuid) return;
        refreshing = true;
        try {
            const [, fresh] = await Promise.all([loadProfile(), fetchSources()]);
            if (fresh.failed) return;
            applyFresh(fresh);
            if (selectedPlan) {
                const match = findPlan(activeTab, activeNet, selectedPlan.plan_id);
                if (!match || Number(match.price) !== Number(selectedPlan.price)) {
                    clearSelection();
                    toast('Plans were updated. Please choose a plan again.', 'err');
                } else {
                    selectedPlan = match;
                }
            }
            reconcile();
        } finally {
            refreshing = false;
        }
    }

    async function initialize() {
        uuid = sessionId();
        if (!uuid) {
            localStorage.removeItem(SESSION_KEY);
            window.location.replace('register.html');
            return;
        }
        try {
            const [, fresh] = await Promise.all([loadProfile(), fetchSources()]);
            applyFresh(fresh);
            if (fresh.failed) toast('Network issue. We could not load plans. Check your network and try again.', 'err');
            const withPlans = availableTabs().filter((t) => hasPlans(t.key));
            setTab(withPlans[0] ? withPlans[0].key : 'easy');
        } finally {
            setTimeout(() => hideLoader(() => appContainer.classList.add('ready')), 1600);
        }
    }

    sheet.close.addEventListener('click', () => { closeSheet(); renderAll(); });
    sheet.overlay.addEventListener('click', (e) => { if (e.target === sheet.overlay) { closeSheet(); renderAll(); } });
    sheet.back.addEventListener('click', () => { sheetStep = 'type'; renderSheet(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetStep) { closeSheet(); renderAll(); } });
    $('btnBack').addEventListener('click', () => { if (window.history.length > 1) window.history.back(); else window.location.href = 'dashboard.html'; });
    phoneInput.addEventListener('input', () => { phoneInput.value = phoneInput.value.replace(/\D/g, ''); attemptId = null; checkForm(); });
    $('pinRow').addEventListener('input', checkForm);
    buyBtn.addEventListener('click', submit);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - lastLoaded > STALE_AFTER_MS) refreshQuiet();
    });

    initialize();
})();
