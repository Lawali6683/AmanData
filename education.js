import { supabase } from './supabase.js';
import { SESSION_KEY, sessionId, mountShell, showLoader, hideLoader, toast, pinBoxes, escapeHtml, money } from './ui.js';
import './formpopup.js';

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
    const API_ENDPOINT = '/api/edu';
    const REQUEST_TIMEOUT_MS = 60000;
    const EXAMS = [
        { key: 'wec_data', name: 'WAEC', logo: LOGOS.waec },
        { key: 'neco_data', name: 'NECO', logo: LOGOS.neco },
        { key: 'nabteb_data', name: 'NABTEB', logo: LOGOS.nabteb },
        { key: 'jamb_data', name: 'JAMB', logo: LOGOS.jamb }
    ];

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const appContainer = $('appContainer');
    const examGrid = $('examGrid');
    const itemList = $('itemList');
    const buyForm = $('buyForm');
    const qtyInput = $('qty');
    const profileInput = $('profile');
    const phoneInput = $('phone');
    const buyBtn = $('btnBuy');
    const pin = pinBoxes($('pinRow'));

    let uuid = null;
    let balance = 0;
    let catalog = {};
    let exam = null;
    let item = null;
    let verifiedProfile = '';
    let attemptId = null;
    let busy = false;
    let lastPins = [];

    function newToken() {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    async function post(payload, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
        try {
            const res = await fetch(API_ENDPOINT, {
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
        catalog = {};
        try {
            const res = await fetch('/api/catalog?type=exam', { cache: 'no-store' });
            const data = await res.json();
            if (!data || !data.success || !data.exams) throw new Error('catalog');
            catalog = data.exams;
        } catch (err) {
            catalog = {};
            toast('Exam prices could not be loaded. Please check your connection.', 'err');
        }
    }

    function renderExams() {
        examGrid.innerHTML = '';
        EXAMS.forEach((e) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'net-tile' + (exam && exam.key === e.key ? ' active' : '');
            tile.innerHTML = '<img src="' + e.logo + '" alt="' + e.name + '">' + e.name;
            tile.addEventListener('click', () => {
                exam = e;
                item = null;
                attemptId = null;
                buyForm.classList.add('hidden');
                renderExams();
                renderItems();
            });
            examGrid.appendChild(tile);
        });
    }

    function renderItems() {
        itemList.innerHTML = '';
        if (!exam) return;
        const list = catalog[exam.key] || [];
        if (!list.length) {
            itemList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-circle-xmark empty-icon"></i><h3 class="empty-title">Not Available</h3><p class="empty-desc">This exam pin is not available right now. Please try again later.</p></div>';
            return;
        }
        list.forEach((x) => {
            const card = document.createElement('div');
            card.className = 'transaction-card' + (item && String(item.exam_id) === String(x.exam_id) ? ' selected' : '');
            card.innerHTML =
                '<div class="tx-left"><div class="tx-icon-frame"><img src="' + exam.logo + '" alt="' + exam.name + '"></div>' +
                '<div class="tx-meta"><span class="tx-title">' + escapeHtml(x.exam_name) + '</span>' +
                '<span class="tx-date">' + (x.mode === 'profile_code' ? 'Profile code required' : 'Result checker pin') + '</span></div></div>' +
                '<div class="tx-right"><span class="tx-amount">₦' + escapeHtml(money(x.price)) + '</span></div>';
            card.addEventListener('click', () => selectItem(x));
            itemList.appendChild(card);
        });
    }

    function isProfile() { return item && item.mode === 'profile_code'; }
    function qtyValue() {
        if (isProfile()) return 1;
        const q = Number(qtyInput.value);
        return Number.isInteger(q) && q >= 1 && q <= 10 ? q : null;
    }

    function selectItem(x) {
        item = x;
        attemptId = null;
        verifiedProfile = '';
        profileInput.value = '';
        qtyInput.value = '1';
        $('candRow').classList.add('hidden');
        $('qtyField').classList.toggle('hidden', isProfile());
        $('profField').classList.toggle('hidden', !isProfile());
        $('fExam').textContent = x.exam_name;
        $('fUnit').textContent = '₦' + money(x.price);
        buyForm.classList.remove('hidden');
        renderItems();
        checkForm();
    }

    function checkForm() {
        if (!item) return;
        const q = qtyValue();
        $('fTotal').textContent = q !== null ? '₦' + money(Number(item.price) * q) : '-';
        qtyInput.classList.toggle('ok', q !== null);
        qtyInput.classList.toggle('bad', !isProfile() && qtyInput.value !== '' && q === null);
        const profOk = /^\d{10}$/.test(profileInput.value);
        profileInput.classList.toggle('ok', profOk && verifiedProfile === profileInput.value);
        const phoneOk = phoneInput.value === '' || /^(0\d{10}|234\d{10})$/.test(phoneInput.value);
        phoneInput.classList.toggle('bad', phoneInput.value.length >= 11 && !phoneOk);
        const ready = isProfile() ? (verifiedProfile !== '' && verifiedProfile === profileInput.value) : q !== null;
        buyBtn.hidden = !(ready && phoneOk && pin.valid());
    }

    async function verify() {
        if (busy || !/^\d{10}$/.test(profileInput.value)) {
            if (!busy) toast('Please enter a valid 10-digit JAMB profile code.', 'err');
            return;
        }
        busy = true;
        showLoader();
        let result;
        try {
            result = await post({ action: 'verify', uuid: uuid, profile_id: profileInput.value }, 30000);
        } finally {
            hideLoader();
            busy = false;
        }
        if (result && result.success && result.name) {
            verifiedProfile = profileInput.value;
            $('candName').textContent = result.name;
            $('candRow').classList.remove('hidden');
            toast('Profile verified successfully.', 'ok');
        } else {
            verifiedProfile = '';
            $('candRow').classList.add('hidden');
            toast((result && result.message) || 'We could not verify this profile code.', 'err');
        }
        checkForm();
    }

    async function copyText(text) {
        let ok = false;
        try {
            await navigator.clipboard.writeText(text);
            ok = true;
        } catch (err) {
            try {
                const t = document.createElement('textarea');
                t.value = text;
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
        toast(ok ? 'Copied.' : 'Could not copy. Copy it by hand.', ok ? 'ok' : 'err');
    }

    function pinText(p) { return 'PIN: ' + p.pin + (p.serial ? '\nSERIAL: ' + p.serial : ''); }

    function showResult(result) {
        lastPins = Array.isArray(result.pins) ? result.pins : [];
        $('resultMsg').textContent = result.message || '';
        const list = $('pinList');
        list.innerHTML = '';
        lastPins.forEach((p) => {
            const box = document.createElement('div');
            box.className = 'token-box pre';
            box.textContent = pinText(p);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-small alt';
            btn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy';
            btn.addEventListener('click', () => copyText(pinText(p)));
            const wrap = document.createElement('div');
            wrap.className = 'history-list';
            wrap.appendChild(box);
            wrap.appendChild(btn);
            list.appendChild(wrap);
        });
        $('btnCopyAll').classList.toggle('hidden', lastPins.length < 2);
        $('resultCard').classList.remove('hidden');
        $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function submit() {
        if (busy || !item) return;
        const q = qtyValue();
        if (q === null) {
            toast('Quantity must be between 1 and 10.', 'err');
            return;
        }
        if (Number(item.price) * q > balance) {
            toast('Your wallet balance is not enough. Please fund your wallet.', 'err');
            return;
        }
        busy = true;
        buyBtn.disabled = true;
        showLoader();
        if (!attemptId) attemptId = newToken();

        let result;
        try {
            result = await post({
                uuid: uuid,
                exam_key: exam.key,
                exam_id: String(item.exam_id),
                quantity: q,
                profile_code: isProfile() ? profileInput.value : '',
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
            toast('Purchase successful.', 'ok');
            phoneInput.value = '';
            profileInput.value = '';
            verifiedProfile = '';
            pin.clear();
            item = null;
            attemptId = null;
            buyForm.classList.add('hidden');
            renderItems();
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
        renderExams();
        try {
            await Promise.all([loadProfile(), loadCatalog()]);
        } finally {
            setTimeout(() => hideLoader(() => appContainer.classList.add('ready')), 1600);
        }
    }

    $('btnBack').addEventListener('click', () => { if (window.history.length > 1) window.history.back(); else window.location.href = 'dashboard.html'; });
    $('btnVerify').addEventListener('click', verify);
    $('btnCopyAll').addEventListener('click', () => copyText(lastPins.map(pinText).join('\n\n')));
    $('btnCloseResult').addEventListener('click', () => $('resultCard').classList.add('hidden'));
    qtyInput.addEventListener('input', () => { qtyInput.value = qtyInput.value.replace(/\D/g, ''); attemptId = null; checkForm(); });
    profileInput.addEventListener('input', () => {
        profileInput.value = profileInput.value.replace(/\D/g, '');
        attemptId = null;
        if (verifiedProfile !== profileInput.value) $('candRow').classList.add('hidden');
        checkForm();
    });
    phoneInput.addEventListener('input', () => { phoneInput.value = phoneInput.value.replace(/\D/g, ''); attemptId = null; checkForm(); });
    $('pinRow').addEventListener('input', checkForm);
    buyBtn.addEventListener('click', submit);

    initialize();
})();
