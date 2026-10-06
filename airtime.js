import { supabase } from './supabase.js';
import { SESSION_KEY, sessionId, mountShell, showLoader, hideLoader, toast, pinBoxes, money } from './ui.js';

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
    const API_ENDPOINT = '/api/airtime';
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
    let busy = false;

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

    function renderNetworks() {
        netGrid.innerHTML = '';
        NETWORKS.forEach((n) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'net-tile' + (network && network.key === n.key ? ' active' : '');
            tile.innerHTML = '<img src="' + n.logo + '" alt="' + n.name + '">' + n.name;
            tile.addEventListener('click', () => {
                network = n;
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
        buyBtn.hidden = !(network && phoneValid() && a !== null && pin.valid());
    }

    async function submit() {
        if (busy || !network) return;
        const amount = amountValue();
        if (amount > balance) {
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
                body: JSON.stringify({ uuid: uuid, network: network.key, phone: phoneInput.value, amount: amount, pin: pin.value() })
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
            toast(result.message || 'Airtime purchase successful.', 'ok');
            phoneInput.value = '';
            amountInput.value = '';
            pin.clear();
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
        renderNetworks();
        try {
            await loadProfile();
        } finally {
            setTimeout(() => hideLoader(() => appContainer.classList.add('ready')), 1600);
        }
    }

    QUICK.forEach((q) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-small alt';
        b.textContent = '₦' + q;
        b.addEventListener('click', () => { amountInput.value = String(q); checkForm(); });
        $('quickRow').appendChild(b);
    });

    $('btnBack').addEventListener('click', () => { if (window.history.length > 1) window.history.back(); else window.location.href = 'dashboard.html'; });
    phoneInput.addEventListener('input', () => { phoneInput.value = phoneInput.value.replace(/\D/g, ''); checkForm(); });
    amountInput.addEventListener('input', () => { amountInput.value = amountInput.value.replace(/\D/g, ''); checkForm(); });
    $('pinRow').addEventListener('input', checkForm);
    buyBtn.addEventListener('click', submit);

    initialize();
})();