import { supabase } from './supabase.js';
import { SESSION_KEY, sessionId, mountShell, showLoader, hideLoader, toast, pinBoxes, escapeHtml, money } from './ui.js';

const LOGOS = {
   dstv: 'https://i.imgur.com/YZoTk8t.png',
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

(function () {
    const API_ENDPOINT = '/api/tv';
    const CATALOG_ENDPOINT = '/api/catalog?type=cable';
    const REQUEST_TIMEOUT_MS = 60000;
    const PROVIDERS = [
        { key: 'DSTV', name: 'DSTV', match: 'DSTV', logo: LOGOS.dstv },
        { key: 'GOTV', name: 'GOTV', match: 'GOTV', logo: LOGOS.gotv },
        { key: 'STARTIMES', name: 'STARTIMES', match: 'STARTIME', logo: LOGOS.startimes }
    ];

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const appContainer = $('appContainer');
    const provGrid = $('provGrid');
    const planList = $('planList');
    const buyForm = $('buyForm');
    const iucInput = $('iuc');
    const phoneInput = $('phone');
    const buyBtn = $('btnBuy');
    const pin = pinBoxes($('pinRow'));

    iucInput.maxLength = 11;

    let uuid = null;
    let balance = 0;
    let plans = [];
    let loadFailed = false;
    let provider = null;
    let selected = null;
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

    function plansFor(p) {
        return plans.filter((x) => String(x.cable_name || '').toUpperCase().indexOf(p.match) === 0 && Number(x.price) > 0)
            .sort((a, b) => Number(a.price) - Number(b.price));
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

    async function loadPlans() {
        try {
            const res = await fetch(CATALOG_ENDPOINT, { cache: 'no-store' });
            const data = await res.json();
            if (!data || !data.success || !data.cable) throw new Error('catalog');
            plans = [].concat.apply([], Object.keys(data.cable).map((k) => data.cable[k]));
        } catch (err) {
            plans = [];
            loadFailed = true;
            toast('TV packages could not be loaded. Please check your connection.', 'err');
        }
    }

    function renderEmpty(icon, title, desc) {
        planList.innerHTML = '<div class="empty-state"><i class="fa-solid ' + icon + ' empty-icon"></i><h3 class="empty-title">' + escapeHtml(title) + '</h3><p class="empty-desc">' + escapeHtml(desc) + '</p></div>';
    }

    function renderProviders() {
        provGrid.innerHTML = '';
        PROVIDERS.forEach((p) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'net-tile' + (provider && provider.key === p.key ? ' active' : '');
            tile.innerHTML = '<img src="' + p.logo + '" alt="' + p.name + '">' + p.name;
            tile.addEventListener('click', () => {
                provider = p;
                selected = null;
                attemptId = null;
                buyForm.classList.add('hidden');
                renderProviders();
                renderPlans();
            });
            provGrid.appendChild(tile);
        });
    }

    function renderPlans() {
        planList.innerHTML = '';
        if (!provider) return;
        const list = plansFor(provider);
        if (!list.length) {
            if (loadFailed) {
                renderEmpty('fa-triangle-exclamation', 'Packages not loaded', 'We could not load the TV packages. Please check your connection and refresh the page.');
            } else if (!plans.length) {
                renderEmpty('fa-box-open', 'No packages yet', 'No TV package is on sale right now. Please check again later.');
            } else {
                renderEmpty('fa-circle-xmark', 'Not Available', 'Packages for this provider are not available right now. Please try again later.');
            }
            return;
        }
        list.forEach((p) => {
            const card = document.createElement('div');
            card.className = 'transaction-card' + (selected && String(selected.plan_id) === String(p.plan_id) && selected.cable_name === p.cable_name ? ' selected' : '');
            card.innerHTML =
                '<div class="tx-left"><div class="tx-icon-frame"><img src="' + provider.logo + '" alt="' + provider.name + '"></div>' +
                '<div class="tx-meta"><span class="tx-title">' + escapeHtml(p.plan_name) + '</span>' +
                '<span class="tx-date">' + escapeHtml(provider.name) + '</span></div></div>' +
                '<div class="tx-right"><span class="tx-amount">₦' + escapeHtml(money(p.price)) + '</span></div>';
            card.addEventListener('click', () => {
                selected = p;
                attemptId = null;
                $('fProvider').textContent = provider.name;
                $('fPlan').textContent = p.plan_name;
                $('fPrice').textContent = '₦' + money(p.price);
                buyForm.classList.remove('hidden');
                renderPlans();
                checkForm();
            });
            planList.appendChild(card);
        });
    }

    function iucValid() { return /^\d{10,11}$/.test(iucInput.value); }
    function phoneValid() { return phoneInput.value === '' || /^(0\d{10}|234\d{10})$/.test(phoneInput.value); }

    function checkForm() {
        iucInput.classList.toggle('ok', iucValid());
        phoneInput.classList.toggle('ok', phoneInput.value !== '' && phoneValid());
        phoneInput.classList.toggle('bad', phoneInput.value.length >= 11 && !phoneValid());
        buyBtn.hidden = !(selected && iucValid() && phoneValid() && pin.valid());
    }

    async function submit() {
        if (busy || !selected) return;
        if (Number(selected.price) > balance) {
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
                provider: provider.key,
                plan_id: String(selected.plan_id),
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
            toast(result.message || 'Subscription renewed successfully.', 'ok');
            iucInput.value = '';
            phoneInput.value = '';
            pin.clear();
            selected = null;
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
        renderProviders();
        try {
            await Promise.all([loadProfile(), loadPlans()]);
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
