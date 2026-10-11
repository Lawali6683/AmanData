import { supabase } from './supabase.js';
import { SESSION_KEY, sessionId, mountShell, showLoader, hideLoader, toast, pinBoxes, escapeHtml, money } from './ui.js';

const LOGOS = {
    '9mobile': 'https://i.imgur.com/bMOx9Q3.png',
    airtel: 'https://i.imgur.com/fEWKTML.png',
    glo: 'https://i.imgur.com/gEvagGA.png',
    mtn: 'https://i.imgur.com/U82jQBd.png'
};

(function () {
    const API_ENDPOINT = '/api/airtime';
    const CATALOG_ENDPOINT = '/api/catalog?type=airtime';
    const REQUEST_TIMEOUT_MS = 60000;
    const NETWORKS = [
        { key: 'mtn', name: 'MTN', logo: LOGOS.mtn },
        { key: 'airtel', name: 'AIRTEL', logo: LOGOS.airtel },
        { key: 'glo', name: 'GLO', logo: LOGOS.glo },
        { key: '9mobile', name: '9MOBILE', logo: LOGOS['9mobile'] }
    ];
    const QUICK = [100, 200, 500, 1000];

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const appContainer = $('appContainer');
    const netGrid = $('netGrid');
    const buyForm = $('buyForm');
    const phoneInput = $('phone');
    const amountInput = $('amount');
    const buyBtn = $('btnBuy');
    const pin = pinBoxes($('pinRow'));

    let uuid = null;
    let balance = 0;
    let network = null;
    let rules = null;
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

    function ensureRow(id, label) {
        let el = $(id);
        if (el) return el;
        const row = document.createElement('div');
        row.className = 'detail-row';
        row.innerHTML = '<span class="detail-row-label">' + escapeHtml(label) + '</span><span class="detail-row-val" id="' + id + '">-</span>';
        buyBtn.parentNode.insertBefore(row, buyBtn);
        return $(id);
    }

    function chargeFor(amount) {
        const rule = network && rules ? rules[network.key] : null;
        if (!rule || !(rule.value > 0)) return 0;
        return rule.mode === 'fixed' ? Math.round(rule.value * 100) / 100 : Math.round(amount * rule.value) / 100;
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

    async function loadRules() {
        try {
            const res = await fetch(CATALOG_ENDPOINT, { cache: 'no-store' });
            const data = await res.json();
            if (!data || !data.success || !Array.isArray(data.networks)) throw new Error('catalog');
            rules = {};
            data.networks.forEach((n) => { rules[n.item_id] = n; });
        } catch (err) {
            rules = null;
        }
    }

    function renderNetworks() {
        netGrid.innerHTML = '';
        if (!rules) {
            netGrid.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-xmark empty-icon"></i><h3 class="empty-title">Not Available</h3><p class="empty-desc">Airtime could not be loaded. Please try again later.</p></div>';
            return;
        }
        NETWORKS.filter((n) => rules[n.key] && rules[n.key].enabled !== false).forEach((n) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'net-tile' + (network && network.key === n.key ? ' active' : '');
            tile.innerHTML = '<img src="' + n.logo + '" alt="' + n.name + '">' + n.name;
            tile.addEventListener('click', () => {
                network = n;
                attemptId = null;
                $('fNetwork').textContent = n.name;
                buyForm.classList.remove('hidden');
                renderNetworks();
                buyForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
                checkForm();
            });
            netGrid.appendChild(tile);
        });
    }

    function phoneValid() {
        return /^(0\d{10}|234\d{10})$/.test(phoneInput.value);
    }

    function amountValue() {
        const a = Number(amountInput.value);
        return Number.isInteger(a) && a >= 50 && a <= 50000 ? a : null;
    }

    function checkForm() {
        const a = amountValue();
        phoneInput.classList.toggle('ok', phoneValid());
        phoneInput.classList.toggle('bad', phoneInput.value.length >= 11 && !phoneValid());
        amountInput.classList.toggle('ok', a !== null);
        amountInput.classList.toggle('bad', amountInput.value.length >= 3 && a === null);
        $('fAmount').textContent = a !== null ? '₦' + money(a) : '-';
        if (network) {
            const fee = a !== null ? chargeFor(a) : 0;
            ensureRow('fFee', 'Service charge').textContent = a !== null ? '₦' + money(fee) : '-';
            ensureRow('fTotal', 'You will pay').textContent = a !== null ? '₦' + money(a + fee) : '-';
        }
        buyBtn.hidden = !(network && phoneValid() && a !== null && pin.valid());
    }

    async function submit() {
        if (busy || !network) return;
        const amount = amountValue();
        if (amount === null) {
            toast('Enter an amount from ₦50 to ₦50,000.', 'err');
            return;
        }
        if (amount + chargeFor(amount) > balance) {
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
                network: network.key,
                phone: phoneInput.value,
                amount: amount,
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
            toast(result.message || 'Airtime purchase successful.', 'ok');
            phoneInput.value = '';
            amountInput.value = '';
            pin.clear();
            attemptId = null;
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
            await Promise.all([loadProfile(), loadRules()]);
            renderNetworks();
        } finally {
            setTimeout(() => hideLoader(() => appContainer.classList.add('ready')), 1600);
        }
    }

    QUICK.forEach((q) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-small alt';
        b.textContent = '₦' + q;
        b.addEventListener('click', () => { amountInput.value = String(q); attemptId = null; checkForm(); });
        $('quickRow').appendChild(b);
    });

    $('btnBack').addEventListener('click', () => { if (window.history.length > 1) window.history.back(); else window.location.href = 'dashboard.html'; });
    phoneInput.addEventListener('input', () => { phoneInput.value = phoneInput.value.replace(/\D/g, ''); attemptId = null; checkForm(); });
    amountInput.addEventListener('input', () => { amountInput.value = amountInput.value.replace(/\D/g, ''); attemptId = null; checkForm(); });
    $('pinRow').addEventListener('input', checkForm);
    buyBtn.addEventListener('click', submit);

    initialize();
})();
