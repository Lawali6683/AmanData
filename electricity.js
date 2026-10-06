import { supabase } from './supabase.js';
import { SESSION_KEY, sessionId, mountShell, showLoader, hideLoader, toast, pinBoxes, escapeHtml, money } from './ui.js';

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

(function () {
    const API_ENDPOINT = '/api/electricitypay';

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const appContainer = $('appContainer');
    const discoList = $('discoList');
    const buyForm = $('buyForm');
    const meterInput = $('meter');
    const amountInput = $('amount');
    const phoneInput = $('phone');
    const buyBtn = $('btnBuy');
    const pin = pinBoxes($('pinRow'));

    let uuid = null;
    let balance = 0;
    let discos = [];
    let disco = null;
    let meterType = 'prepaid';
    let busy = false;
    let lastToken = '';

    async function post(payload) {
        const res = await fetch(API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        return res.json();
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

    async function loadDiscos() {
        try {
            const data = await post({ action: 'discos' });
            discos = data && data.success && Array.isArray(data.discos) ? data.discos : [];
        } catch (err) {
            discos = [];
        }
    }

    function renderDiscos() {
        discoList.innerHTML = '';
        if (!discos.length) {
            discoList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-xmark empty-icon"></i><h3 class="empty-title">Not Available</h3><p class="empty-desc">Electricity companies could not be loaded. Please try again later.</p></div>';
            return;
        }
        discos.forEach((d) => {
            const card = document.createElement('div');
            card.className = 'transaction-card' + (disco && disco.plan_id === d.plan_id ? ' selected' : '');
            card.innerHTML =
                '<div class="tx-left"><div class="tx-icon-frame"><img src="' + LOGOS.nepa + '" alt="Electricity"></div>' +
                '<div class="tx-meta"><span class="tx-title">' + escapeHtml(d.disco_name) + '</span><span class="tx-date">Prepaid & Postpaid</span></div></div>' +
                '<i class="fa-solid fa-chevron-right" style="color:var(--text-muted)"></i>';
            card.addEventListener('click', () => {
                disco = d;
                $('fDisco').textContent = d.disco_name;
                buyForm.classList.remove('hidden');
                renderDiscos();
                buyForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
                checkForm();
            });
            discoList.appendChild(card);
        });
    }

    function meterValid() { return /^\d{6,20}$/.test(meterInput.value); }
    function phoneValid() { return phoneInput.value === '' || /^(0\d{10}|234\d{10})$/.test(phoneInput.value); }
    function amountValue() {
        const a = Number(amountInput.value);
        return Number.isInteger(a) && a >= 500 && a <= 500000 ? a : null;
    }

    function checkForm() {
        const a = amountValue();
        meterInput.classList.toggle('ok', meterValid());
        amountInput.classList.toggle('ok', a !== null);
        amountInput.classList.toggle('bad', amountInput.value.length >= 3 && a === null);
        phoneInput.classList.toggle('ok', phoneInput.value !== '' && phoneValid());
        phoneInput.classList.toggle('bad', phoneInput.value.length >= 11 && !phoneValid());
        buyBtn.hidden = !(disco && meterValid() && a !== null && phoneValid() && pin.valid());
    }

    function setType(t) {
        meterType = t;
        $('tabPre').classList.toggle('active', t === 'prepaid');
        $('tabPost').classList.toggle('active', t === 'postpaid');
    }

    function showResult(result) {
        lastToken = result.token || '';
        $('resultMsg').textContent = result.message || '';
        const rows = [];
        if (result.units) rows.push(['Units', result.units]);
        rows.push(['Amount', '₦' + money(result.amount)]);
        $('resultRows').innerHTML = rows.map((r) =>
            '<div class="detail-row"><span class="detail-row-label">' + escapeHtml(r[0]) + '</span><span class="detail-row-val">' + escapeHtml(r[1]) + '</span></div>').join('');
        $('tokenBox').textContent = lastToken;
        $('tokenBox').classList.toggle('hidden', !lastToken);
        $('btnCopy').classList.toggle('hidden', !lastToken);
        $('resultCard').classList.remove('hidden');
        $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function copyToken() {
        try {
            await navigator.clipboard.writeText(lastToken);
        } catch (err) {
            const t = document.createElement('textarea');
            t.value = lastToken;
            document.body.appendChild(t);
            t.select();
            document.execCommand('copy');
            document.body.removeChild(t);
        }
        toast('Token copied.', 'ok');
    }

    async function submit() {
        if (busy || !disco) return;
        const amount = amountValue();
        if (amount > balance) {
            toast('Your wallet balance is not enough. Please fund your wallet.', 'err');
            return;
        }
        busy = true;
        showLoader();
        let result = null;
        try {
            result = await post({ uuid: uuid, disco: disco.plan_id, meter_type: meterType, meter: meterInput.value, amount: amount, phone: phoneInput.value, pin: pin.value() });
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
            toast('Electricity payment successful.', 'ok');
            meterInput.value = '';
            amountInput.value = '';
            phoneInput.value = '';
            pin.clear();
            disco = null;
            buyForm.classList.add('hidden');
            renderDiscos();
            checkForm();
            showResult(result);
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
        try {
            await Promise.all([loadProfile(), loadDiscos()]);
            renderDiscos();
        } finally {
            setTimeout(() => hideLoader(() => appContainer.classList.add('ready')), 1600);
        }
    }

    $('btnBack').addEventListener('click', () => { if (window.history.length > 1) window.history.back(); else window.location.href = 'dashboard.html'; });
    $('tabPre').addEventListener('click', () => setType('prepaid'));
    $('tabPost').addEventListener('click', () => setType('postpaid'));
    $('btnCopy').addEventListener('click', copyToken);
    $('btnCloseResult').addEventListener('click', () => $('resultCard').classList.add('hidden'));
    meterInput.addEventListener('input', () => { meterInput.value = meterInput.value.replace(/\D/g, ''); checkForm(); });
    amountInput.addEventListener('input', () => { amountInput.value = amountInput.value.replace(/\D/g, ''); checkForm(); });
    phoneInput.addEventListener('input', () => { phoneInput.value = phoneInput.value.replace(/\D/g, ''); checkForm(); });
    $('pinRow').addEventListener('input', checkForm);
    buyBtn.addEventListener('click', submit);

    initialize();
})();