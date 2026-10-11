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
    const SIM_NETWORKS = { mtn_plan: 'mtn', itel_data: 'airtel', glo_data: 'glo', '9mobile_data': '9mobile' };
    const NETWORKS = [
        { key: 'mtn_plan', name: 'MTN', logo: LOGOS.mtn },
        { key: 'itel_data', name: 'AIRTEL', logo: LOGOS.airtel },
        { key: 'glo_data', name: 'GLO', logo: LOGOS.glo },
        { key: '9mobile_data', name: '9MOBILE', logo: LOGOS['9mobile'] }
    ];

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const appContainer = $('appContainer');
    const planList = $('planList');
    const netRow = $('netRow');
    const buyForm = $('buyForm');
    const phoneInput = $('phone');
    const buyBtn = $('btnBuy');
    const pin = pinBoxes($('pinRow'));

    let uuid = null;
    let balance = 0;
    let sources = { easy: {}, simple: {} };
    let activeTab = 'easy';
    let activeNet = null;
    let selectedPlan = null;
    let attemptId = null;
    let busy = false;

    function newToken() {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
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
                return { success: false, unsure: true, message: 'The server did not answer properly (' + res.status + '). Please check your history before trying again.' };
            }
            return data;
        } catch (err) {
            return { success: false, unsure: true, message: 'Network problem. Please check your history before trying again.' };
        } finally {
            clearTimeout(timer);
        }
    }

    function normalize(row) {
        const out = {};
        NETWORKS.forEach((n) => {
            let v = row ? row[n.key] : null;
            if (typeof v === 'string') {
                try { v = JSON.parse(v); } catch (err) { v = null; }
            }
            const list = Array.isArray(v) ? v.filter((p) => p && Number(p.price) > 0) : [];
            if (list.length) out[n.key] = list;
        });
        return out;
    }

    async function loadTable(name) {
        try {
            const { data, error } = await supabase.from(name).select('*').limit(1);
            if (error) throw error;
            return data && data.length ? data[0] : null;
        } catch (err) {
            return null;
        }
    }

    async function loadOnline() {
        try {
            const { data, error } = await supabase.from('sim_status').select('network,online');
            if (error) throw error;
            const map = {};
            (data || []).forEach((r) => { map[r.network] = !!r.online; });
            return map;
        } catch (err) {
            return null;
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
            toast('Unable to load your account details.', 'err');
        }
        $('sumBalance').textContent = money(balance);
    }

    function renderEmpty(icon, title, desc) {
        planList.innerHTML = '<div class="empty-state"><i class="fa-solid ' + icon + ' empty-icon"></i>' +
            '<h3 class="empty-title">' + escapeHtml(title) + '</h3><p class="empty-desc">' + escapeHtml(desc) + '</p></div>';
    }

    function renderNets() {
        const available = NETWORKS.filter((n) => sources[activeTab][n.key]);
        netRow.innerHTML = '';
        available.forEach((n) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'net-chip' + (n.key === activeNet ? ' active' : '');
            chip.innerHTML = '<img src="' + n.logo + '" alt="' + n.name + '">' + n.name;
            chip.addEventListener('click', () => {
                activeNet = n.key;
                selectedPlan = null;
                attemptId = null;
                buyForm.classList.add('hidden');
                renderNets();
                renderPlans();
            });
            netRow.appendChild(chip);
        });
    }

    function renderPlans() {
        planList.innerHTML = '';
        if (!activeNet) {
            renderEmpty('fa-circle-xmark', 'Not Available', 'This plan type is not available right now. Please try the other plan.');
            return;
        }
        const net = NETWORKS.find((n) => n.key === activeNet);
        const list = sources[activeTab][activeNet].slice().sort((a, b) => Number(a.price) - Number(b.price));
        list.forEach((p) => {
            const card = document.createElement('div');
            card.className = 'transaction-card' + (selectedPlan && String(selectedPlan.plan_id) === String(p.plan_id) ? ' selected' : '');
            card.innerHTML =
                '<div class="tx-left"><div class="tx-icon-frame"><img src="' + net.logo + '" alt="' + net.name + '"></div>' +
                '<div class="tx-meta"><span class="tx-title">' + escapeHtml(p.plan_name) + '</span>' +
                '<span class="tx-date">' + escapeHtml([p.plan_type, p.plan_day].filter(Boolean).join(' • ')) + '</span></div></div>' +
                '<div class="tx-right"><span class="tx-amount">₦' + escapeHtml(money(p.price)) + '</span></div>';
            card.addEventListener('click', () => selectPlan(p));
            planList.appendChild(card);
        });
    }

    function selectPlan(p) {
        selectedPlan = p;
        attemptId = null;
        const net = NETWORKS.find((n) => n.key === activeNet);
        $('fNetwork').textContent = net.name;
        $('fPlan').textContent = p.plan_name;
        $('fDay').textContent = p.plan_day || '-';
        $('fPrice').textContent = '₦' + money(p.price);
        buyForm.classList.remove('hidden');
        renderPlans();
        buyForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
        checkForm();
    }

    function setTab(tab) {
        activeTab = tab;
        $('tabEasy').classList.toggle('active', tab === 'easy');
        $('tabSimple').classList.toggle('active', tab === 'simple');
        const first = NETWORKS.find((n) => sources[tab][n.key]);
        activeNet = first ? first.key : null;
        selectedPlan = null;
        attemptId = null;
        buyForm.classList.add('hidden');
        renderNets();
        renderPlans();
    }

    function phoneValid() {
        return /^(0\d{10}|234\d{10})$/.test(phoneInput.value);
    }

    function checkForm() {
        phoneInput.classList.toggle('ok', phoneValid());
        phoneInput.classList.toggle('bad', phoneInput.value.length > 0 && !phoneValid() && phoneInput.value.length >= 11);
        buyBtn.hidden = !(selectedPlan && phoneValid() && pin.valid());
    }

    async function submit() {
        if (busy || !selectedPlan) return;
        if (Number(selectedPlan.price) > balance) {
            toast('Your wallet balance is not enough for this plan. Please fund your wallet.', 'err');
            return;
        }
        busy = true;
        buyBtn.disabled = true;
        showLoader();
        if (!attemptId) attemptId = newToken();

        let result;
        try {
            result = await postJson(activeTab === 'easy' ? EASY_ENDPOINT : API_ENDPOINT, {
                uuid: uuid,
                source: activeTab,
                network_key: activeNet,
                plan_id: String(selectedPlan.plan_id),
                phone: phoneInput.value,
                pin: pin.value(),
                request_id: attemptId
            }, REQUEST_TIMEOUT_MS);
        } finally {
            hideLoader();
            busy = false;
            buyBtn.disabled = false;
        }

        if (!result.unsure && !result.pending) attemptId = null;

        if (result.balance !== undefined && result.balance !== null) {
            balance = Number(result.balance) || 0;
            $('sumBalance').textContent = money(balance);
        }

        if (result.success) {
            toast(result.message || 'Purchase successful.', 'ok');
            phoneInput.value = '';
            pin.clear();
            selectedPlan = null;
            attemptId = null;
            buyForm.classList.add('hidden');
            renderPlans();
            checkForm();
            return;
        }

        toast(result.message || 'Something went wrong. Please try again.', 'err');
    }

    async function initialize() {
        uuid = sessionId();
        if (!uuid) {
            localStorage.removeItem(SESSION_KEY);
            window.location.replace('register.html');
            return;
        }
        try {
            const [, easyRow, simpleRow, online] = await Promise.all([loadProfile(), loadTable('myapi'), loadTable('buydata'), loadOnline()]);
            sources = { easy: normalize(easyRow), simple: normalize(simpleRow) };
            if (online) {
                Object.keys(sources.easy).forEach((k) => { if (!online[SIM_NETWORKS[k]]) delete sources.easy[k]; });
            }
            setTab(Object.keys(sources.easy).length ? 'easy' : 'simple');
        } catch (err) {
            renderEmpty('fa-circle-xmark', 'Not Available', 'Data plans could not be loaded. Please try again later.');
        } finally {
            setTimeout(() => hideLoader(() => appContainer.classList.add('ready')), 1600);
        }
    }

    $('btnBack').addEventListener('click', () => { if (window.history.length > 1) window.history.back(); else window.location.href = 'dashboard.html'; });
    $('tabEasy').addEventListener('click', () => setTab('easy'));
    $('tabSimple').addEventListener('click', () => setTab('simple'));
    phoneInput.addEventListener('input', () => { phoneInput.value = phoneInput.value.replace(/\D/g, ''); attemptId = null; checkForm(); });
    $('pinRow').addEventListener('input', checkForm);
    buyBtn.addEventListener('click', submit);

    initialize();
})();
