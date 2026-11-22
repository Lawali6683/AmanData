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
    const typeRow = ensureRow('typeRow', netRow);
    const dayRow = ensureRow('dayRow', typeRow);
    const buyForm = $('buyForm');
    const phoneInput = $('phone');
    const buyBtn = $('btnBuy');
    const pin = pinBoxes($('pinRow'));

    let uuid = null;
    let balance = 0;
    let sources = { easy: {}, simple: {} };
    let extraTabs = [];
    let activeTab = 'easy';
    let activeNet = null;
    let activeType = null;
    let activeBucket = null;
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

    function ensureRow(id, anchor) {
        let node = $(id);
        if (node) return node;
        node = document.createElement('div');
        node.id = id;
        node.className = 'bd-pills';
        anchor.parentNode.insertBefore(node, anchor.nextSibling);
        return node;
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

    function clearSelection() {
        selectedPlan = null;
        attemptId = null;
        buyForm.classList.add('hidden');
    }

    function syncFilters() {
        const items = activeNet ? enrich(netPlans(activeTab, activeNet)) : [];
        const types = orderedTypes(items);
        if (!types.some((t) => t.key === activeType)) activeType = types[0] ? types[0].key : null;
        const buckets = orderedBuckets(items.filter((i) => i.type.key === activeType));
        if (!buckets.some((b) => b.key === activeBucket)) activeBucket = buckets[0] ? buckets[0].key : null;
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
            btn.addEventListener('click', () => {
                activeNet = n.key;
                clearSelection();
                syncFilters();
                renderAll();
            });
            netRow.appendChild(btn);
        });
    }

    function renderPills(row, list, activeKey, onPick) {
        row.innerHTML = '';
        setVisible(row, list.length > 0);
        list.forEach((entry) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'bd-pill' + (entry.key === activeKey ? ' active' : '');
            btn.innerHTML = '<span class="bd-pill-label">' + escapeHtml(entry.label) + '</span><span class="bd-pill-count">' + entry.count + '</span>';
            btn.addEventListener('click', () => onPick(entry.key));
            row.appendChild(btn);
        });
    }

    function renderTypes() {
        const items = activeNet ? enrich(netPlans(activeTab, activeNet)) : [];
        renderPills(typeRow, orderedTypes(items), activeType, (key) => {
            activeType = key;
            clearSelection();
            syncFilters();
            renderAll();
        });
    }

    function renderBuckets() {
        const items = activeNet ? enrich(netPlans(activeTab, activeNet)).filter((i) => i.type.key === activeType) : [];
        renderPills(dayRow, orderedBuckets(items), activeBucket, (key) => {
            activeBucket = key;
            clearSelection();
            renderAll();
        });
    }

    function renderEmpty(icon, title, desc) {
        planList.innerHTML = '<div class="empty-state"><i class="fa-solid ' + icon + ' empty-icon"></i>' +
            '<h3 class="empty-title">' + escapeHtml(title) + '</h3><p class="empty-desc">' + escapeHtml(desc) + '</p></div>';
    }

    function renderPlans() {
        planList.innerHTML = '';
        if (!activeNet) {
            if (loadFailed) {
                renderEmpty('fa-triangle-exclamation', 'Plans not loaded', 'Network issue. Check your network and open this page again.');
            } else if (!hasAnyPlans()) {
                renderEmpty('fa-box-open', 'No plans now', 'No data plan is available now. Please check again later.');
            } else {
                renderEmpty('fa-circle-xmark', 'Not available', 'This plan type is not available now. Please try another plan.');
            }
            return;
        }
        const items = enrich(netPlans(activeTab, activeNet))
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
        renderTypes();
        renderBuckets();
        renderPlans();
    }

    function reconcile() {
        const tabs = availableTabs();
        if (!tabs.some((t) => t.key === activeTab)) activeTab = tabs[0] ? tabs[0].key : 'easy';
        if (!activeNet || !netPlans(activeTab, activeNet).length) {
            const first = firstNet(activeTab);
            activeNet = first ? first.key : null;
        }
        syncFilters();
        renderAll();
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
        const first = firstNet(tab);
        activeNet = first ? first.key : null;
        activeType = null;
        activeBucket = null;
        clearSelection();
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

    $('btnBack').addEventListener('click', () => { if (window.history.length > 1) window.history.back(); else window.location.href = 'dashboard.html'; });
    phoneInput.addEventListener('input', () => { phoneInput.value = phoneInput.value.replace(/\D/g, ''); attemptId = null; checkForm(); });
    $('pinRow').addEventListener('input', checkForm);
    buyBtn.addEventListener('click', submit);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - lastLoaded > STALE_AFTER_MS) refreshQuiet();
    });

    initialize();
})();
