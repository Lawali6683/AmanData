import { supabase } from './supabase.js';
import { SESSION_KEY, sessionId, mountShell, showLoader, hideLoader, toast, pinBoxes, escapeHtml, money } from './ui.js';

(function () {
    const API_ENDPOINT = '/api/electricitypay';
    const CATALOG_ENDPOINT = '/api/catalog?type=electricity';
    const REQUEST_TIMEOUT_MS = 60000;

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
    let discosError = '';
    let disco = null;
    let meterType = 'prepaid';
    let attemptId = null;
    let busy = false;
    let lastToken = '';

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
        if (!disco || !(disco.value > 0)) return 0;
        return disco.mode === 'fixed' ? Math.round(disco.value * 100) / 100 : Math.round(amount * disco.value) / 100;
    }

    function logoFrame(d) {
        const frame = document.createElement('div');
        frame.className = 'tx-icon-frame';
        const icon = '<i class="fa-solid fa-bolt"></i>';
        if (!d.logo) {
            frame.innerHTML = icon;
            return frame;
        }
        const img = document.createElement('img');
        img.alt = d.disco_name;
        img.addEventListener('error', () => { frame.innerHTML = icon; });
        img.src = d.logo;
        frame.appendChild(img);
        return frame;
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
            const res = await fetch(CATALOG_ENDPOINT, { cache: 'no-store' });
            const data = await res.json();
            if (!data || !data.success || !Array.isArray(data.discos)) {
                discosError = (data && data.message) || 'Electricity companies could not be loaded. Please try again later.';
                discos = [];
                return;
            }
            discos = data.discos.filter((d) => d.enabled !== false);
        } catch (err) {
            discosError = 'Network problem. Electricity companies could not be loaded.';
            discos = [];
        }
    }

    function renderDiscos() {
        discoList.innerHTML = '';
        if (!discos.length) {
            discoList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-xmark empty-icon"></i><h3 class="empty-title">Not Available</h3><p class="empty-desc">' + escapeHtml(discosError || 'No electricity company is available right now. Please try again later.') + '</p></div>';
            return;
        }
        discos.forEach((d) => {
            const card = document.createElement('div');
            card.className = 'transaction-card' + (disco && disco.plan_id === d.plan_id ? ' selected' : '');
            const left = document.createElement('div');
            left.className = 'tx-left';
            left.appendChild(logoFrame(d));
            const meta = document.createElement('div');
            meta.className = 'tx-meta';
            meta.innerHTML = '<span class="tx-title">' + escapeHtml(d.disco_name) + '</span><span class="tx-date">Prepaid & Postpaid</span>';
            left.appendChild(meta);
            card.appendChild(left);
            card.insertAdjacentHTML('beforeend', '<i class="fa-solid fa-chevron-right" style="color:var(--text-muted)"></i>');
            card.addEventListener('click', () => {
                disco = d;
                attemptId = null;
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
        if (disco) {
            const fee = a !== null ? chargeFor(a) : 0;
            ensureRow('fFee', 'Service charge').textContent = a !== null ? '₦' + money(fee) : '-';
            ensureRow('fTotal', 'You will pay').textContent = a !== null ? '₦' + money(a + fee) : '-';
        }
        buyBtn.hidden = !(disco && meterValid() && a !== null && phoneValid() && pin.valid());
    }

    function setType(t) {
        meterType = t;
        attemptId = null;
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
        let ok = false;
        try {
            await navigator.clipboard.writeText(lastToken);
            ok = true;
        } catch (err) {
            try {
                const t = document.createElement('textarea');
                t.value = lastToken;
                t.setAttribute('readonly', '');
                t.style.position = 'fixed';
                t.style.opacity = '0';
                document.body.appendChild(t);
                t.select();
                ok = document.execCommand('copy');
                document.body.removeChild(t);
            } catch (e) {
                ok = false;
            }
        }
        toast(ok ? 'Token copied.' : 'Could not copy. Copy it by hand.', ok ? 'ok' : 'err');
    }

    async function submit() {
        if (busy || !disco) return;
        const amount = amountValue();
        if (amount === null) {
            toast('Enter an amount from ₦500 to ₦500,000.', 'err');
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
                disco: disco.plan_id,
                meter_type: meterType,
                meter: meterInput.value,
                amount: amount,
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
            toast('Electricity payment successful.', 'ok');
            meterInput.value = '';
            amountInput.value = '';
            phoneInput.value = '';
            pin.clear();
            disco = null;
            attemptId = null;
            buyForm.classList.add('hidden');
            renderDiscos();
            checkForm();
            showResult(result);
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
    meterInput.addEventListener('input', () => { meterInput.value = meterInput.value.replace(/\D/g, ''); attemptId = null; checkForm(); });
    amountInput.addEventListener('input', () => { amountInput.value = amountInput.value.replace(/\D/g, ''); attemptId = null; checkForm(); });
    phoneInput.addEventListener('input', () => { phoneInput.value = phoneInput.value.replace(/\D/g, ''); attemptId = null; checkForm(); });
    $('pinRow').addEventListener('input', checkForm);
    buyBtn.addEventListener('click', submit);

    initialize();
})();
