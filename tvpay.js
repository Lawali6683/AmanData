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

    let uuid = null;
    let balance = 0;
    let plans = [];
    let provider = null;
    let selected = null;
    let busy = false;

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
            const { data, error } = await supabase.from('cabletv').select('*').limit(1);
            if (error) throw error;
            let list = data && data[0] ? data[0].alltv_plan : [];
            if (typeof list === 'string') list = JSON.parse(list);
            plans = Array.isArray(list) ? list : [];
        } catch (err) {
            plans = [];
        }
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
            planList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-xmark empty-icon"></i><h3 class="empty-title">Not Available</h3><p class="empty-desc">Packages for this provider are not available right now. Please try again later.</p></div>';
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
                $('fProvider').textContent = provider.name;
                $('fPlan').textContent = p.plan_name;
                $('fPrice').textContent = '₦' + money(p.price);
                buyForm.classList.remove('hidden');
                renderPlans();
                buyForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
                checkForm();
            });
            planList.appendChild(card);
        });
    }

    function iucValid() { return /^\d{10}$/.test(iucInput.value); }
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
        showLoader();
        let result = null;
        try {
            const res = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uuid: uuid,
                    provider: provider.key,
                    plan_id: String(selected.plan_id),
                    iuc: iucInput.value,
                    phone: phoneInput.value,
                    pin: pin.value()
                })
            });
            result = await res.json();
        } catch (err) {
            result = { success: false, message: 'Network error. Please check your connection and your history before trying again.' };
        }
        hideLoader();
        busy = false;

        if (result && result.success) {
            if (result.balance !== undefined) {
                balance = Number(result.balance) || 0;
                $('sumBalance').textContent = money(balance);
            }
            toast(result.message || 'Subscription renewed successfully.', 'ok');
            iucInput.value = '';
            phoneInput.value = '';
            pin.clear();
            selected = null;
            buyForm.classList.add('hidden');
            renderPlans();
            checkForm();
        } else {
            toast((result && result.message) || 'Something went wrong. Please try again.', 'err');
        }
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
        } finally {
            setTimeout(() => hideLoader(() => appContainer.classList.add('ready')), 1600);
        }
    }

    $('btnBack').addEventListener('click', () => { if (window.history.length > 1) window.history.back(); else window.location.href = 'dashboard.html'; });
    iucInput.addEventListener('input', () => { iucInput.value = iucInput.value.replace(/\D/g, ''); checkForm(); });
    phoneInput.addEventListener('input', () => { phoneInput.value = phoneInput.value.replace(/\D/g, ''); checkForm(); });
    $('pinRow').addEventListener('input', checkForm);
    buyBtn.addEventListener('click', submit);

    initialize();
})();
