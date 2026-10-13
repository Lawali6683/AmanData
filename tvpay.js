import { supabase } from './supabase.js';
import { SESSION_KEY, sessionId, mountShell, showLoader, hideLoader, toast, pinBoxes, escapeHtml, money } from './ui.js';

const LOGOS = {
    DSTV: 'https://i.imgur.com/XBe4eRi.png',
    GOTV: 'https://i.imgur.com/eaTdFAU.png',
    STARTIME: 'https://i.imgur.com/3DbujW2.png'
};

(function () {
    const API_ENDPOINT = '/api/tvpay';
    const CATALOG_ENDPOINT = '/api/catalog?type=cable';
    const REQUEST_TIMEOUT_MS = 60000;
    const CABLES = [
        { key: 'DSTV', name: 'DSTV', logo: LOGOS.DSTV },
        { key: 'GOTV', name: 'GOTV', logo: LOGOS.GOTV },
        { key: 'STARTIME', name: 'STARTIMES', logo: LOGOS.STARTIME }
    ];

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const appContainer = $('appContainer');
    const cableGrid = $('cableGrid');
    const planList = $('planList');
    const buyForm = $('buyForm');
    const iucInput = $('iuc');
    const phoneInput = $('phone');
    const buyBtn = $('btnBuy');
    const pin = pinBoxes($('pinRow'));

    let uuid = null;
    let balance = 0;
    let catalog = {};
    let loadFailed = false;
    let cable = null;
    let plan = null;
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

    async function loadCatalog() {
        try {
            const res = await fetch(CATALOG_ENDPOINT, { cache: 'no-store' });
            const data = await res.json();
            if (!data || !data.success || !data.cable) throw new Error('catalog');
            catalog = data.cable;
        } catch (err) {
            catalog = {};
            loadFailed = true;
            toast('TV packages could not be loaded. Please check your connection.', 'err');
        }
    }

    function renderEmpty(icon, title, desc) {
        planList.innerHTML = '<div class="empty-state"><i class="fa-solid ' + icon + ' empty-icon"></i>' +
            '<h3 class="empty-title">' + escapeHtml(title) + '</h3><p class="empty-desc">' + escapeHtml(desc) + '</p></div>';
    }

    function renderCables() {
        cableGrid.innerHTML = '';
        CABLES.forEach((c) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'net-tile' + (cable && cable.key === c.key ? ' active' : '');
            tile.innerHTML = '<img src="' + c.logo + '" alt="' + c.name + '">' + c.name;
            tile.addEventListener('click', () => {
                cable = c;
                plan = null;
                attemptId = null;
                buyForm.classList.add('hidden');
                renderCables();
                renderPlans();
                planList.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            cableGrid.appendChild(tile);
        });
    }

    function renderPlans() {
        planList.innerHTML = '';
        if (!cable) {
            if (loadFailed) renderEmpty('fa-triangle-exclamation', 'Packages not loaded', 'We could not load the TV packages. Please check your connection and refresh the page.');
            return;
        }
        const list = (catalog[cable.key] || []).slice().sort((a, b) => Number(a.price) - Number(b.price));
        if (!list.length) {
            renderEmpty('fa-box-open', 'No packages yet', 'No ' + cable.name + ' package is on sale right now. Please check again later.');
            return;
        }
        list.forEach((p) => {
            const card = document.createElement('div');
            card.className = 'transaction-card' + (plan && String(plan.plan_id) === String(p.plan_id) ? ' selected' : '');
            card.innerHTML =
                '<div class="tx-left"><div class="tx-icon-frame"><img src="' + cable.logo + '" alt="' + cable.name + '"></div>' +
                '<div class="tx-meta"><span class="tx-title">' + escapeHtml(p.plan_name) + '</span>' +
                '<span class="tx-date">' + escapeHtml(cable.name) + '</span></div></div>' +
                '<div class="tx-right"><span class="tx-amount">₦' + escapeHtml(money(p.price)) + '</span></div>';
            card.addEventListener('click', () => selectPlan(p));
            planList.appendChild(card);
        });
    }

    function selectPlan(p) {
        plan = p;
        attemptId = null;
        $('fCable').textContent = cable.name;
        $('fPlan').textContent = p.plan_name;
        $('fPrice').textContent = '₦' + money(p.price);
        buyForm.classList.remove('hidden');
        renderPlans();
        checkForm();
    }

    function iucValid() { return /^\d{10,11}$/.test(iucInput.value); }
    function phoneValid() { return phoneInput.value === '' || /^(0\d{10}|234\d{10})$/.test(phoneInput.value); }

    function checkForm() {
        iucInput.classList.toggle('ok', iucValid());
        iucInput.classList.toggle('bad', iucInput.value.length >= 11 && !iucValid());
        phoneInput.classList.toggle('ok', phoneInput.value !== '' && phoneValid());
        phoneInput.classList.toggle('bad', phoneInput.value.length >= 11 && !phoneValid());
        buyBtn.hidden = !(plan && iucValid() && phoneValid() && pin.valid());
    }

    async function submit() {
        if (busy || !plan || !cable) return;
        if (Number(plan.price) > balance) {
            toast('Your wallet balance is not enough. Please fund your wallet.', 'err');
            return;
        }
        busy = true;
        buyBtn.disabled = true;
        showLoader();
        if (!attemptId) attemptId = newToken();

        let result;
        try {
            result = await postJson(API_ENDPOINT, {
                uuid: uuid,
                cable: cable.key,
                plan_id: String(plan.plan_id),
                iuc: iucInput.value,
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
            toast(result.message || 'TV subscription successful.', 'ok');
            iucInput.value = '';
            phoneInput.value = '';
            pin.clear();
            plan = null;
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
        renderCables();
        try {
            await Promise.all([loadProfile(), loadCatalog()]);
            renderPlans();
        } finally {
            setTimeout(() => hideLoader(() => appContainer.classList.add('ready')), 1600);
        }
    }

    $('btnBack').addEventListener('click', () => { if (window.history.length > 1) window.history.back(); else window.location.href = 'dashboard.html'; });
    iucInput.addEventListener('input', () => { iucInput.value = iucInput.value.replace(/\D/g, ''); attemptId = null; checkForm(); });
    phoneInput.addEventListener('input', () => { phoneInput.value = phoneInput.value.replace(/\D/g, ''); attemptId = null; checkForm(); });
    $('pinRow').addEventListener('input', checkForm);
    buyBtn.addEventListener('click', submit);

    initialize();
})();
