import { supabase } from './supabase.js';

(function () {
    const API_ENDPOINT = '/api/withdraw';
    const REQ_PASS = '@haruna66';
    const SESSION_KEY = 'puredata_user_session';
    const PIN_FIELD = 'pin';
    const FEE_RATE = 0.01;
    const LOAD_TIMEOUT = 15000;
    const VERIFY_TIMEOUT = 20000;
    const SUBMIT_TIMEOUT = 40000;
    const LOADER_SAFETY = 12000;
    const LOADER_DELAY = 400;
    const BANKS_TIMEOUT = 10000;
    const PRIORITY_BANKS = [/opay/i, /palmpay/i, /moniepoint/i, /kuda/i, /guaranty|gtbank/i, /^access/i, /zenith/i, /united bank for africa|^uba$/i, /first bank/i];
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
    const pinIcons = ['s1', 's2', 's3', 's4'].map((id) => $(id));
    const submitBtn = $('submitBtn');
    const historyBtn = $('historyBtn');
    const historyOverlay = $('historyOverlay');
    const historyClose = $('historyClose');
    const historyBody = $('historyBody');
    const toastHost = $('toastContainer');
    const btnBack = $('btnBack');

    const submitLabel = submitBtn ? submitBtn.textContent : '';
    const noFundsHtml = noFundsBox ? noFundsBox.innerHTML : '';

    const verifyNote = (() => {
        const host = (verifyLoader && verifyLoader.parentNode) || (accountInput && accountInput.parentNode && accountInput.parentNode.parentNode);
        if (!host) return null;
        const el = document.createElement('div');
        el.style.cssText = 'display:none;margin-top:8px;font-size:13px;line-height:1.4;color:#dc2626';
        el.setAttribute('role', 'alert');
        if (verifyLoader && verifyLoader.parentNode === host) host.insertBefore(el, verifyLoader.nextSibling);
        else host.appendChild(el);
        return el;
    })();

    let userUUID = null;
    let balance = 0;
    let storedPin = '';
    let balanceError = false;
    let overviewError = false;
    let pending = null;
    let withdrawals = [];
    let verified = { key: '', name: '' };
    let verifyToken = 0;
    let verifyPromise = null;
    let verifyMessage = '';
    let busy = false;
    let pinClearTimer = null;
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
            const rawPin = String(userData[PIN_FIELD] === undefined || userData[PIN_FIELD] === null ? '' : userData[PIN_FIELD]).trim();
            storedPin = /^\d{4}$/.test(rawPin) ? rawPin : '';
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
        updateSubmit();
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

    function clearNote() {
        if (!verifyNote) return;
        verifyNote.style.display = 'none';
        verifyNote.textContent = '';
    }

    function showNote(message, retryable) {
        if (!verifyNote) return;
        verifyNote.textContent = message;
        if (retryable) {
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.textContent = 'Try again';
            retry.style.cssText = 'margin-left:8px;background:none;border:0;padding:0;color:inherit;font:inherit;font-weight:700;text-decoration:underline;cursor:pointer';
            retry.addEventListener('click', () => { verifyAccount(); });
            verifyNote.appendChild(retry);
        }
        verifyNote.style.display = 'block';
    }

    function resetVerification() {
        verified = { key: '', name: '' };
        updateSubmit();
        verifyToken++;
        verifyMessage = '';
        if (nameGroup) nameGroup.style.display = 'none';
        if (accountName) accountName.value = '';
        clearNote();
        setVerifying(false);
    }

    function accountKey() {
        return (bankSelect ? bankSelect.value : '') + ':' + (accountInput ? accountInput.value : '');
    }

    function verifyAccount() {
        const bank = bankSelect ? bankSelect.value : '';
        const number = accountInput ? accountInput.value : '';
        if (!bank || !/^\d{10}$/.test(number)) return Promise.resolve(false);

        const key = bank + ':' + number;
        if (verified.key === key) return Promise.resolve(true);

        const token = ++verifyToken;
        verifyMessage = '';
        clearNote();
        setVerifying(true);

        const run = (async () => {
            const payload = { action: 'verify_account', bank_code: bank, account_number: number };
            const started = Date.now();
            let res = await postApi(payload, VERIFY_TIMEOUT);
            if (token !== verifyToken) return false;
            if (res.unsure && Date.now() - started < VERIFY_TIMEOUT / 2) {
                res = await postApi(payload, VERIFY_TIMEOUT);
                if (token !== verifyToken) return false;
            }
            setVerifying(false);

            if (res.success && res.account_name) {
                verified = { key: key, name: String(res.account_name) };
                if (accountName) accountName.value = verified.name;
                if (nameGroup) nameGroup.style.display = 'block';
                clearNote();
                updateSubmit();
                return true;
            }

            verified = { key: '', name: '' };
            updateSubmit();
            if (nameGroup) nameGroup.style.display = 'none';
            verifyMessage = res.message || 'Could not verify this account. Please check the details.';
            showNote(verifyMessage, Boolean(res.unsure || res.retry));
            return false;
        })();

        verifyPromise = run;
        run.finally(() => {
            if (verifyPromise === run) verifyPromise = null;
        });
        return run;
    }

    async function ensureVerified() {
        let current = verifyPromise || verifyAccount();
        for (let i = 0; i < 4; i++) {
            await current;
            if (verified.key === accountKey()) return true;
            if (!verifyPromise || verifyPromise === current) return false;
            current = verifyPromise;
        }
        return false;
    }

    function rankBank(name) {
        const index = PRIORITY_BANKS.findIndex((pattern) => pattern.test(name));
        return index === -1 ? PRIORITY_BANKS.length : index;
    }

    function populateBanks(list) {
        const current = bankSelect.value;
        const sorted = list.slice().sort((a, b) => rankBank(a.name) - rankBank(b.name) || a.name.localeCompare(b.name));
        const fragment = document.createDocumentFragment();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '-- Choose Bank --';
        fragment.appendChild(placeholder);
        const seen = new Set();
        sorted.forEach((bank) => {
            if (seen.has(bank.code)) return;
            seen.add(bank.code);
            const option = document.createElement('option');
            option.value = bank.code;
            option.textContent = bank.name;
            fragment.appendChild(option);
        });
        bankSelect.innerHTML = '';
        bankSelect.appendChild(fragment);
        if (current && seen.has(current)) bankSelect.value = current;
        else if (current) resetVerification();
    }

    async function loadBanks() {
        if (!bankSelect) return;
        const res = await postApi({ action: 'banks' }, BANKS_TIMEOUT);
        if (res.success && Array.isArray(res.banks) && res.banks.length > 0) populateBanks(res.banks);
    }

    function pinValue() {
        return pinBoxes.map((box) => box.value).join('');
    }

    function pinMatches() {
        return storedPin !== '' && pinValue() === storedPin;
    }

    function paintPin() {
        pinBoxes.forEach((box, index) => {
            const icon = pinIcons[index];
            if (!icon) return;
            const digit = box.value;
            if (!digit || !storedPin) {
                icon.textContent = '';
                return;
            }
            const right = digit === storedPin.charAt(index);
            icon.textContent = right ? '✔️' : '❌';
            icon.style.color = right ? '#16a34a' : '#dc2626';
            icon.style.fontWeight = '700';
            icon.style.textAlign = 'center';
        });
    }

    function clearPin() {
        clearTimeout(pinClearTimer);
        pinBoxes.forEach((box) => {
            box.value = '';
            box.classList.remove('filled');
        });
        paintPin();
        updateSubmit();
        if (pinBoxes[0]) pinBoxes[0].focus();
    }

    function formReady() {
        const amount = round2(toAmount(amountInput ? amountInput.value : 0));
        const bank = bankSelect ? bankSelect.value : '';
        return amount > 0 && amount <= balance && Boolean(bank) && verified.key !== '' && verified.key === accountKey() && pinMatches();
    }

    function updateSubmit() {
        if (!submitBtn) return;
        submitBtn.style.display = formReady() || busy ? '' : 'none';
    }

    function checkPin() {
        clearTimeout(pinClearTimer);
        paintPin();
        updateSubmit();
        const pin = pinValue();
        if (!/^\d{4}$/.test(pin)) return;
        if (!storedPin) {
            toast('Your transaction PIN was not found. Please set it from your profile.');
            return;
        }
        if (pin !== storedPin) {
            toast('Incorrect transaction PIN');
            pinClearTimer = setTimeout(clearPin, 700);
        }
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
        paintPin();
        updateFee();
        updateSubmit();
    }

    async function refresh() {
        await Promise.allSettled([loadBalance(), loadOverview()]);
        render();
    }

    function setBusy(flag, label) {
        busy = flag;
        if (!submitBtn) return;
        submitBtn.disabled = flag;
        submitBtn.textContent = flag ? label : submitLabel;
        updateSubmit();
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
        if (!/^\d{4}$/.test(pin)) return toast('Enter your 4 digit transaction PIN.');
        if (!pinMatches()) return toast('Incorrect transaction PIN');

        const submitted = bank + ':' + number;
        if (verified.key !== submitted) {
            setBusy(true, 'Verifying...');
            const ok = await ensureVerified();
            setBusy(false);
            if (!ok) return toast(verifyMessage || 'Could not verify this account. Please check the details.');
            if (accountKey() !== submitted) return toast('Account details changed. Please check them and try again.');
        }

        setBusy(true, 'Processing...');

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

        setBusy(false);

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

    function setupWidget() {
        const widget = $('pd-whatsapp-widget');
        const link = $('pd-wa-link');
        if (!widget || !link) return;

        let dragging = false;
        let moved = false;
        let startX = 0;
        let startY = 0;
        let initialX = 0;
        let initialY = 0;

        function point(event) {
            const source = event.touches && event.touches.length ? event.touches[0] : event;
            return { x: source.clientX, y: source.clientY };
        }

        function dragStart(event) {
            moved = false;
            dragging = true;
            const p = point(event);
            const rect = widget.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            startX = p.x;
            startY = p.y;
        }

        function drag(event) {
            if (!dragging) return;
            if (event.cancelable) event.preventDefault();
            const p = point(event);
            const dx = p.x - startX;
            const dy = p.y - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;

            const maxX = window.innerWidth - widget.offsetWidth - 10;
            const maxY = window.innerHeight - widget.offsetHeight - 10;
            const x = Math.max(10, Math.min(initialX + dx, maxX));
            const y = Math.max(10, Math.min(initialY + dy, maxY));

            widget.style.left = x + 'px';
            widget.style.top = y + 'px';
            widget.style.bottom = 'auto';
            widget.style.right = 'auto';
        }

        function dragEnd() {
            dragging = false;
        }

        widget.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);
        widget.addEventListener('touchstart', dragStart, { passive: false });
        document.addEventListener('touchmove', drag, { passive: false });
        document.addEventListener('touchend', dragEnd);
        link.addEventListener('click', (event) => {
            if (moved) event.preventDefault();
        });
    }

    if (btnBack) btnBack.addEventListener('click', () => { window.location.href = 'dashboard.html'; });

    if (amountInput) {
        amountInput.addEventListener('input', () => {
            updateFee();
            updateSubmit();
        });
    }

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
            checkPin();
        });
        box.addEventListener('keydown', (event) => {
            if (event.key === 'Backspace' && !box.value && index > 0) pinBoxes[index - 1].focus();
        });
    });

    if (submitBtn) {
        submitBtn.style.display = 'none';
        submitBtn.addEventListener('click', submit);
    }
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

    setupWidget();

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
        loadBanks().catch(() => {});
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
