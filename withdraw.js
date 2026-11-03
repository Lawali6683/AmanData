import { supabase } from './supabase.js';

(function () {
    const API_ENDPOINT = '/api/withdraw';
    const REQ_PASS = '@haruna66';
    const SESSION_KEY = 'puredata_user_session';
    const FEE_RATE = 0.01;
    const LOAD_TIMEOUT = 15000;
    const VERIFY_TIMEOUT = 20000;
    const SUBMIT_TIMEOUT = 40000;
    const LOADER_SAFETY = 12000;
    const LOADER_DELAY = 400;
    const SHOW_CLASSES = ['show', 'visible', 'active', 'open'];

    const $ = (id) => document.getElementById(id);
    const scene = $('loadingScene');
    const liquid = $('liquid');
    const brand = $('brand');
    const loaderLogo = $('loaderLogo');
    const bg = $('bg');
    const pageContainer = document.querySelector('.page-container');
    const balanceEl = $('user_balance');
    const noFundsBox = $('noFundsBox');
    const pendingBox = $('pendingBox');
    const pendingTitle = $('pendingTitle');
    const pendingMessage = $('pendingMessage');
    const pendingDetails = $('pendingDetails');
    const formArea = $('formArea');
    const amountInput = $('amount');
    const feeEl = $('fee_calc');
    const bankSelect = $('bank_code');
    const accountInput = $('account_number');
    const verifyLoader = $('verificationLoader');
    const nameGroup = $('nameGroup');
    const accountName = $('account_name');
    const pinBoxes = ['p1', 'p2', 'p3', 'p4'].map((id) => $(id)).filter(Boolean);
    const submitBtn = $('submitBtn');
    const historyBtn = $('historyBtn');
    const historyOverlay = $('historyOverlay');
    const historyClose = $('historyClose');
    const historyBody = $('historyBody');
    const toastHost = $('toastContainer');

    const submitLabel = submitBtn ? submitBtn.textContent : '';
    const noFundsHtml = noFundsBox ? noFundsBox.innerHTML : '';

    let userUUID = null;
    let balance = 0;
    let balanceError = false;
    let overviewError = false;
    let pending = null;
    let withdrawals = [];
    let verified = { key: '', name: '' };
    let verifyToken = 0;
    let busy = false;
    let loaderHidden = false;

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function toAmount(value) {
        const number = parseFloat(String(value === undefined || value === null ? 0 : value).replace(/,/g, ''));
        return isFinite(number) ? number : 0;
    }

    function round2(value) {
        return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    }

    function money(value) {
        return (Number(value) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatDate(value) {
        const date = new Date(value);
        if (!value || isNaN(date.getTime())) return '-';
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' +
            date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    function setText(el, value) {
        if (el) el.textContent = value;
    }

    function withTimeout(promise, ms) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('timeout')), ms);
            Promise.resolve(promise).then(
                (value) => { clearTimeout(timer); resolve(value); },
                (error) => { clearTimeout(timer); reject(error); }
            );
        });
    }

    function reveal(el, display) {
        if (!el) return;
        el.style.display = '';
        el.style.visibility = '';
        el.style.opacity = '';
        SHOW_CLASSES.forEach((name) => el.classList.add(name));
        const style = window.getComputedStyle(el);
        if (style.display === 'none') el.style.display = display || 'block';
        if (style.visibility === 'hidden') el.style.visibility = 'visible';
        if (parseFloat(style.opacity) === 0) el.style.opacity = '1';
    }

    function conceal(el) {
        if (!el) return;
        SHOW_CLASSES.forEach((name) => el.classList.remove(name));
        el.style.display = 'none';
    }

    function toast(message, kind) {
        if (!toastHost) return;
        toastHost.innerHTML = '';
        const el = document.createElement('div');
        el.textContent = message;
        el.setAttribute('role', 'alert');
        el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);max-width:90%;padding:12px 16px;border-radius:12px;color:#fff;z-index:99999;font-size:14px;text-align:center;box-shadow:0 6px 20px rgba(0,0,0,.25);background:' +
            (kind === 'ok' ? '#16a34a' : '#dc2626');
        toastHost.appendChild(el);
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3800);
    }

    function startLoader() {
        setTimeout(() => { if (liquid) liquid.classList.add('fill'); }, 300);
    }

    function hideLoader() {
        if (loaderHidden) return;
        loaderHidden = true;
        if (liquid) {
            liquid.style.transition = 'height 0.8s ease';
            liquid.style.height = '0%';
        }
        if (brand) brand.classList.add('hide');
        if (loaderLogo) loaderLogo.classList.add('hide');
        if (bg) bg.classList.add('show');
        setTimeout(() => {
            [scene, brand, loaderLogo].forEach((el) => {
                if (!el) return;
                el.classList.add('hidden');
                el.style.display = 'none';
            });
            if (pageContainer) {
                pageContainer.classList.add('ready');
                pageContainer.style.opacity = '1';
                pageContainer.style.visibility = 'visible';
            }
        }, 600);
    }

    async function postApi(payload, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ req_pass: REQ_PASS }, payload)),
                signal: controller.signal
            });
            let data = null;
            try {
                data = await res.json();
            } catch (err) {
                data = null;
            }
            if (!data || typeof data !== 'object') {
                return { success: false, unsure: true, message: 'The server did not answer properly. Please try again.' };
            }
            return data;
        } catch (err) {
            return { success: false, unsure: true, message: 'Network problem. Please check your connection and try again.' };
        } finally {
            clearTimeout(timer);
        }
    }

    function readSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (err) {
            return null;
        }
    }

    function isPendingStatus(status) {
        return /^(pending|processing|queued|initiated)$/.test(String(status || '').toLowerCase());
    }

    function statusInfo(item) {
        const status = String(item && item.status || '').toLowerCase();
        if (/^(completed|paid|success|successful)$/.test(status)) return { text: 'Paid', color: '#16a34a' };
        if (isPendingStatus(status)) return { text: 'Pending', color: '#d97706' };
        return { text: 'Declined', color: '#dc2626' };
    }

    async function loadBalance() {
        balanceError = false;
        try {
            const { data, error } = await withTimeout(
                supabase.from('user_profiles').select('user_data').eq('id', userUUID),
                LOAD_TIMEOUT
            );
            if (error) throw error;
            const userData = data && data[0] && data[0].user_data ? data[0].user_data : null;
            if (!userData) throw new Error('missing');
            balance = round2(toAmount(userData.user_balance));
        } catch (err) {
            balanceError = true;
        }
    }

    async function loadOverview() {
        const res = await postApi({ action: 'overview', uuid: userUUID }, LOAD_TIMEOUT);
        if (res.success && Array.isArray(res.history)) {
            overviewError = false;
            withdrawals = res.history;
            pending = res.pending || withdrawals.find((item) => isPendingStatus(item.status)) || null;
        } else {
            overviewError = true;
        }
    }

    function detailRow(label, value) {
        return '<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:14px">' +
            '<span style="opacity:.7">' + escapeHtml(label) + '</span>' +
            '<strong style="text-align:right;word-break:break-all">' + escapeHtml(value) + '</strong></div>';
    }

    function setForm(visible) {
        if (formArea) formArea.style.display = visible ? '' : 'none';
    }

    function render() {
        setText(balanceEl, money(balance));

        if (balanceError) {
            if (noFundsBox) {
                noFundsBox.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><strong>Unable to load your balance</strong><span>Please check your connection and refresh the page.</span>';
            }
            reveal(noFundsBox, 'block');
            conceal(pendingBox);
            setForm(false);
            return;
        }

        if (noFundsBox) noFundsBox.innerHTML = noFundsHtml;

        if (pending) {
            const processing = String(pending.status || '').toLowerCase() === 'processing';
            setText(pendingTitle, processing ? 'Withdrawal is being processed' : 'Withdrawal request pending');
            setText(pendingMessage, 'Your withdrawal is waiting to be paid. You can make a new withdrawal once this one is completed.');
            if (pendingDetails) {
                pendingDetails.innerHTML =
                    detailRow('Amount', '₦' + money(pending.amount)) +
                    detailRow('Fee (1%)', '₦' + money(pending.fee)) +
                    detailRow('You will receive', '₦' + money(pending.net_amount)) +
                    detailRow('Bank', pending.bank_name || '-') +
                    detailRow('Account', (pending.account_number || '-') + (pending.account_name ? ' - ' + pending.account_name : '')) +
                    detailRow('Reference', pending.reference || '-') +
                    detailRow('Requested', formatDate(pending.created_at));
            }
            reveal(pendingBox, 'block');
            conceal(noFundsBox);
            setForm(false);
            return;
        }

        conceal(pendingBox);

        if (balance <= 0) {
            reveal(noFundsBox, 'block');
            setForm(false);
            return;
        }

        conceal(noFundsBox);
        setForm(true);
        updateFee();
    }

    function updateFee() {
        const amount = round2(toAmount(amountInput ? amountInput.value : 0));
        const fee = round2(amount * FEE_RATE);
        const net = Math.max(round2(amount - fee), 0);
        setText(feeEl, 'You will receive: ₦' + money(net) + ' (Withdrawal Fee 1%: ₦' + money(fee) + ')');
    }

    function setVerifying(flag) {
        if (flag) reveal(verifyLoader, 'block');
        else conceal(verifyLoader);
    }

    function resetVerification() {
        verified = { key: '', name: '' };
        verifyToken++;
        if (nameGroup) nameGroup.style.display = 'none';
        if (accountName) accountName.value = '';
        setVerifying(false);
    }

    function accountKey() {
        return (bankSelect ? bankSelect.value : '') + ':' + (accountInput ? accountInput.value : '');
    }

    async function verifyAccount() {
        const bank = bankSelect ? bankSelect.value : '';
        const number = accountInput ? accountInput.value : '';
        if (!bank || !/^\d{10}$/.test(number)) return;

        const token = ++verifyToken;
        setVerifying(true);
        const res = await postApi({ action: 'verify_account', bank_code: bank, account_number: number }, VERIFY_TIMEOUT);
        if (token !== verifyToken) return;
        setVerifying(false);

        if (res.success && res.account_name) {
            verified = { key: bank + ':' + number, name: String(res.account_name) };
            if (accountName) accountName.value = verified.name;
            if (nameGroup) nameGroup.style.display = 'block';
        } else {
            verified = { key: '', name: '' };
            if (nameGroup) nameGroup.style.display = 'none';
            toast(res.message || 'Could not verify this account. Please check the details.');
        }
    }

    function pinValue() {
        return pinBoxes.map((box) => box.value).join('');
    }

    function clearPin() {
        pinBoxes.forEach((box) => {
            box.value = '';
            box.classList.remove('filled');
        });
        if (pinBoxes[0]) pinBoxes[0].focus();
    }

    function clearForm() {
        if (amountInput) amountInput.value = '';
        if (bankSelect) bankSelect.value = '';
        if (accountInput) accountInput.value = '';
        resetVerification();
        pinBoxes.forEach((box) => {
            box.value = '';
            box.classList.remove('filled');
        });
        updateFee();
    }

    async function refresh() {
        await Promise.allSettled([loadBalance(), loadOverview()]);
        render();
    }

    async function submit() {
        if (busy) return;

        const amount = round2(toAmount(amountInput ? amountInput.value : 0));
        const bank = bankSelect ? bankSelect.value : '';
        const number = accountInput ? accountInput.value : '';
        const pin = pinValue();

        if (!(amount > 0)) return toast('Enter a valid amount.');
        if (amount > balance) return toast('Insufficient wallet balance.');
        if (!bank) return toast('Select a destination bank.');
        if (!/^\d{10}$/.test(number)) return toast('Enter a valid 10 digit account number.');
        if (verified.key !== accountKey()) {
            verifyAccount();
            return toast('Please wait for your account name to be verified.');
        }
        if (!/^\d{4}$/.test(pin)) return toast('Enter your 4 digit transaction PIN.');

        busy = true;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Processing...';
        }

        const bankName = bankSelect.options[bankSelect.selectedIndex].text;
        const res = await postApi({
            action: 'request_withdraw',
            uuid: userUUID,
            pin: pin,
            bank_code: bank,
            bank_name: bankName,
            account_number: number,
            amount: amount
        }, SUBMIT_TIMEOUT);

        busy = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitLabel;
        }

        if (res.success) {
            toast('Withdrawal request submitted.', 'ok');
            clearForm();
        } else if (res.unsure) {
            toast('We could not confirm your request. Please check below before trying again.');
        } else {
            toast(res.message || 'Something went wrong. Please try again.');
            if (/PIN/i.test(res.message || '')) clearPin();
        }

        await refresh();
    }

    function renderHistory() {
        if (!historyBody) return;
        if (!withdrawals.length) {
            historyBody.innerHTML = '<div style="padding:24px 0;text-align:center;opacity:.7">' +
                (overviewError ? 'Unable to load your withdrawals right now.' : 'No withdrawals yet.') + '</div>';
            return;
        }
        historyBody.innerHTML = withdrawals.map((item) => {
            const info = statusInfo(item);
            return '<div style="display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid rgba(128,128,128,.2)">' +
                '<div><strong>Withdrawal to ' + escapeHtml(item.bank_name || 'Bank') + '</strong><br>' +
                '<small style="opacity:.7">' + escapeHtml(formatDate(item.created_at)) + '</small><br>' +
                '<small style="opacity:.7">' + escapeHtml(item.reference || '') + '</small></div>' +
                '<div style="text-align:right"><strong>₦' + escapeHtml(money(item.net_amount)) + '</strong><br>' +
                '<small style="color:' + info.color + '">' + escapeHtml(info.text) + '</small></div></div>';
        }).join('');
    }

    async function openHistory() {
        renderHistory();
        reveal(historyOverlay, 'flex');
        await loadOverview();
        renderHistory();
        render();
    }

    function closeHistory() {
        conceal(historyOverlay);
    }

    if (amountInput) amountInput.addEventListener('input', updateFee);

    if (bankSelect) {
        bankSelect.addEventListener('change', () => {
            resetVerification();
            verifyAccount();
        });
    }

    if (accountInput) {
        accountInput.addEventListener('input', () => {
            accountInput.value = accountInput.value.replace(/\D/g, '').slice(0, 10);
            resetVerification();
            verifyAccount();
        });
    }

    pinBoxes.forEach((box, index) => {
        box.addEventListener('input', () => {
            box.value = box.value.replace(/\D/g, '').slice(0, 1);
            box.classList.toggle('filled', box.value !== '');
            if (box.value && index < pinBoxes.length - 1) pinBoxes[index + 1].focus();
        });
        box.addEventListener('keydown', (event) => {
            if (event.key === 'Backspace' && !box.value && index > 0) pinBoxes[index - 1].focus();
        });
    });

    if (submitBtn) submitBtn.addEventListener('click', submit);
    if (historyBtn) historyBtn.addEventListener('click', openHistory);
    if (historyClose) historyClose.addEventListener('click', closeHistory);
    if (historyOverlay) {
        historyOverlay.addEventListener('click', (event) => {
            if (event.target === historyOverlay) closeHistory();
        });
    }
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeHistory();
    });

    async function initialize() {
        startLoader();
        const safety = setTimeout(hideLoader, LOADER_SAFETY);

        const session = readSession();
        const id = session ? (session.userId || session.id || (session.user && session.user.id)) : null;

        if (!id) {
            try {
                localStorage.removeItem(SESSION_KEY);
            } catch (err) {}
            window.location.replace('register.html');
            return;
        }

        userUUID = String(id);
        conceal(historyOverlay);
        conceal(verifyLoader);
        conceal(pendingBox);
        conceal(noFundsBox);

        try {
            await Promise.allSettled([loadBalance(), loadOverview()]);
            render();
            if (overviewError && !balanceError) toast('Could not check for pending withdrawals. Please refresh if you have one.');
        } catch (err) {
            toast('Something went wrong. Please refresh the page.');
        } finally {
            clearTimeout(safety);
            setTimeout(hideLoader, LOADER_DELAY);
        }
    }

    function start() {
        initialize().catch(() => { hideLoader(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
