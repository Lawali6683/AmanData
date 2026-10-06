import { supabase } from './supabase.js';

(function () {
    const API_ENDPOINT = "/api/withdraw";
    const REQ_PASS = "@haruna66";
    const FEE_RATE = 0.01;
    const SESSION_KEY = 'puredata_user_session';

    function redirectToRegister() {
        localStorage.removeItem(SESSION_KEY);
        window.location.replace('register.html');
    }

    let activeSession = null;
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        activeSession = raw ? JSON.parse(raw) : null;
    } catch (err) {
        activeSession = null;
    }

    const currentUserId = activeSession ? (activeSession.userId || activeSession.id) : null;
    if (!currentUserId) {
        redirectToRegister();
        return;
    }

    const loadingScene = document.getElementById('loadingScene');
    const liquidFill = document.getElementById('liquid');
    const brandText = document.getElementById('brand');
    const loaderLogo = document.getElementById('loaderLogo');
    const backgroundView = document.getElementById('bg');
    const walletBalanceDisplay = document.getElementById('user_balance');
    const amountInput = document.getElementById('amount');
    const bankCodeSelect = document.getElementById('bank_code');
    const accountNumberInput = document.getElementById('account_number');
    const accountNameInput = document.getElementById('account_name');
    const nameGroupField = document.getElementById('nameGroup');
    const verificationLoader = document.getElementById('verificationLoader');
    const feeCalculationDisplay = document.getElementById('fee_calc');
    const submitBtn = document.getElementById('submitBtn');
    const toastBox = document.getElementById('toastContainer');
    const formArea = document.getElementById('formArea');
    const noFundsBox = document.getElementById('noFundsBox');
    const pendingBox = document.getElementById('pendingBox');
    const pendingTitle = document.getElementById('pendingTitle');
    const pendingMessage = document.getElementById('pendingMessage');
    const pendingDetails = document.getElementById('pendingDetails');
    const historyBtn = document.getElementById('historyBtn');
    const historyOverlay = document.getElementById('historyOverlay');
    const historyBody = document.getElementById('historyBody');
    const historyClose = document.getElementById('historyClose');

    const pinIds = ['p1', 'p2', 'p3', 'p4'];

    let cachedRealBalance = 0;
    let userSecurePin = "";
    let pendingWithdrawal = null;
    let historyList = [];
    let historyLoaded = false;
    let verifiedKey = "";
    let verifyCounter = 0;
    let isSubmitting = false;
    let loaderShownAt = 0;

    function escapeHtml(value) {
        return String(value === undefined || value === null ? "" : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function money(value) {
        const number = Number(value) || 0;
        return number.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatDate(value) {
        if (!value) return "-";
        const date = new Date(value);
        if (isNaN(date.getTime())) return "-";
        return date.toLocaleString('en-NG', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function showToast(text, type = 'error') {
        if (!toastBox) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        const icon = document.createElement('i');
        icon.className = 'fa-solid ' + (type === 'error' ? 'fa-circle-xmark' : 'fa-circle-check');
        icon.style.color = type === 'error' ? '#ef4444' : '#22c55e';
        const message = document.createElement('span');
        message.textContent = text;
        toast.appendChild(icon);
        toast.appendChild(message);
        toastBox.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 50);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    function showLoader(label) {
        loaderShownAt = Date.now();
        if (brandText) {
            brandText.innerHTML = escapeHtml(label) + '<span class="bdot">.</span><span class="bdot">.</span><span class="bdot">.</span>';
            brandText.classList.remove('hide');
        }
        if (loaderLogo) loaderLogo.classList.remove('hide');
        if (backgroundView) backgroundView.classList.remove('show');
        if (loadingScene) loadingScene.classList.remove('hide');
        requestAnimationFrame(() => {
            if (liquidFill) liquidFill.classList.add('fill');
        });
    }

    async function hideLoader() {
        const elapsed = Date.now() - loaderShownAt;
        if (elapsed < 1400) await wait(1400 - elapsed);
        if (liquidFill) liquidFill.classList.remove('fill');
        if (backgroundView) backgroundView.classList.add('show');
        if (brandText) brandText.classList.add('hide');
        if (loaderLogo) loaderLogo.classList.add('hide');
        setTimeout(() => {
            if (loadingScene) loadingScene.classList.add('hide');
        }, 900);
    }

    async function callApi(payload) {
        try {
            const res = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, req_pass: REQ_PASS })
            });
            const data = await res.json();
            return data && typeof data === 'object' ? data : { success: false, message: "Invalid server response" };
        } catch (err) {
            return { success: false, message: "Network error. Please check your connection and try again." };
        }
    }

    function statusLabel(status) {
        if (status === 'completed') return 'Completed';
        if (status === 'cancelled') return 'Declined';
        return 'Pending';
    }

    function statusClass(status) {
        if (status === 'completed') return 'completed';
        if (status === 'cancelled') return 'cancelled';
        return 'pending';
    }

    function renderPending(successMode) {
        if (!pendingWithdrawal) return;
        if (pendingTitle) {
            pendingTitle.textContent = successMode ? 'Withdrawal request successful' : 'Withdrawal request pending';
        }
        if (pendingMessage) {
            pendingMessage.textContent = successMode
                ? 'Your request has been received. Payment may take a few minutes. You can make a new withdrawal once this one is paid.'
                : 'Your withdrawal is waiting to be paid. You can make a new withdrawal once this one is completed.';
        }
        const w = pendingWithdrawal;
        const rows = [
            ['Amount', '₦' + money(w.amount)],
            ['Fee (1%)', '₦' + money(w.fee)],
            ['You will receive', '₦' + money(w.net_amount)],
            ['Bank', w.bank_name],
            ['Account Number', w.account_number],
            ['Account Name', w.account_name],
            ['Requested', formatDate(w.created_at)]
        ];
        pendingDetails.innerHTML = rows
            .map((row) => '<div class="detail-row"><span>' + escapeHtml(row[0]) + '</span><span>' + escapeHtml(row[1]) + '</span></div>')
            .join('');
    }

    function applyViewState(successMode) {
        if (walletBalanceDisplay) walletBalanceDisplay.textContent = cachedRealBalance.toFixed(2);

        if (pendingWithdrawal) {
            renderPending(Boolean(successMode));
            pendingBox.classList.add('visible');
            noFundsBox.classList.remove('visible');
            formArea.style.display = 'none';
            return;
        }

        pendingBox.classList.remove('visible');

        if (cachedRealBalance <= 0) {
            noFundsBox.classList.add('visible');
            formArea.style.display = 'none';
            return;
        }

        noFundsBox.classList.remove('visible');
        formArea.style.display = 'block';
    }

    async function fetchUserProfile() {
        try {
            const { data: profiles, error } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('id', currentUserId);

            if (error) {
                showToast('Database Error: ' + error.message);
                return false;
            }

            if (!profiles || profiles.length === 0) {
                redirectToRegister();
                return false;
            }

            const payload = profiles[0].user_data;
            if (!payload) {
                showToast('Data Error: User profile configuration is empty.');
                return false;
            }

            cachedRealBalance = parseFloat(payload.user_balance || 0) || 0;
            userSecurePin = String(payload.pin || "");
            return true;
        } catch (err) {
            showToast('System Error: ' + (err.message || err));
            return false;
        }
    }

    async function fetchOverview() {
        const data = await callApi({ action: 'overview', uuid: currentUserId });
        if (data.success) {
            pendingWithdrawal = data.pending || null;
            historyList = Array.isArray(data.history) ? data.history : [];
            historyLoaded = true;
            return true;
        }
        return false;
    }

    function renderHistory() {
        if (!historyLoaded) {
            historyBody.innerHTML = '<div class="history-empty"><i class="fa-solid fa-spinner fa-spin"></i>Loading history...</div>';
            return;
        }

        if (historyList.length === 0) {
            historyBody.innerHTML = '<div class="history-empty"><i class="fa-solid fa-receipt"></i>You have not made any withdrawal yet.</div>';
            return;
        }

        const pendingItems = historyList.filter((item) => item.status === 'pending' || item.status === 'processing');
        const otherItems = historyList.filter((item) => item.status !== 'pending' && item.status !== 'processing');

        function card(item) {
            const isPending = item.status === 'pending' || item.status === 'processing';
            const cls = statusClass(item.status);
            const dateLabel = item.status === 'completed' && item.completed_at ? 'Paid on' : 'Requested';
            const dateValue = item.status === 'completed' && item.completed_at ? item.completed_at : item.created_at;
            return '<div class="history-item' + (isPending ? ' is-pending' : '') + '">' +
                '<div class="history-top"><span class="history-amount">₦' + escapeHtml(money(item.amount)) + '</span>' +
                '<span class="badge ' + cls + '">' + escapeHtml(statusLabel(item.status)) + '</span></div>' +
                '<div class="history-line"><span>Received</span><strong>₦' + escapeHtml(money(item.net_amount)) + '</strong></div>' +
                '<div class="history-line"><span>Fee (1%)</span><strong>₦' + escapeHtml(money(item.fee)) + '</strong></div>' +
                '<div class="history-line"><span>Bank</span><strong>' + escapeHtml(item.bank_name) + '</strong></div>' +
                '<div class="history-line"><span>Account</span><strong>' + escapeHtml(item.account_number) + '</strong></div>' +
                '<div class="history-line"><span>' + dateLabel + '</span><strong>' + escapeHtml(formatDate(dateValue)) + '</strong></div>' +
                '</div>';
        }

        let html = "";
        if (pendingItems.length > 0) {
            html += '<div class="history-section-title">Pending</div>' + pendingItems.map(card).join('');
        }
        if (otherItems.length > 0) {
            html += '<div class="history-section-title">Previous Withdrawals</div>' + otherItems.map(card).join('');
        }
        historyBody.innerHTML = html;
    }

    async function openHistory() {
        renderHistory();
        historyOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        const ok = await fetchOverview();
        if (!ok && !historyLoaded) {
            historyBody.innerHTML = '<div class="history-empty"><i class="fa-solid fa-triangle-exclamation"></i>Unable to load history. Please try again.</div>';
            return;
        }
        renderHistory();
        applyViewState(false);
    }

    function closeHistory() {
        historyOverlay.classList.remove('open');
        document.body.style.overflow = '';
    }

    function getCompiledPin() {
        let pin = "";
        for (let i = 1; i <= 4; i++) {
            const box = document.getElementById('p' + i);
            if (box) pin += box.value;
        }
        return pin;
    }

    function resetPinBoxes() {
        for (let i = 1; i <= 4; i++) {
            const box = document.getElementById('p' + i);
            const status = document.getElementById('s' + i);
            if (box) box.value = "";
            if (status) {
                status.className = 'status-icon';
                status.innerHTML = "";
            }
        }
    }

    function updateFeeDisplay() {
        const amt = parseFloat(amountInput.value) || 0;
        if (amt > cachedRealBalance) {
            feeCalculationDisplay.className = 'fee-display error';
            feeCalculationDisplay.textContent = 'Amount is higher than your wallet balance of ₦' + money(cachedRealBalance);
            return;
        }
        const fee = Math.round(amt * FEE_RATE * 100) / 100;
        const net = Math.round((amt - fee) * 100) / 100;
        feeCalculationDisplay.className = 'fee-display';
        feeCalculationDisplay.textContent = 'You will receive: ₦' + money(net) + ' (Withdrawal Fee 1%: ₦' + money(fee) + ')';
    }

    function checkFormValidity() {
        const amt = parseFloat(amountInput.value) || 0;
        const currentKey = bankCodeSelect.value + ':' + accountNumberInput.value;
        const nameReady = accountNameInput.value !== "" && verifiedKey === currentKey;
        const pinReady = userSecurePin.length === 4 && getCompiledPin() === userSecurePin;

        if (!isSubmitting && amt > 0 && amt <= cachedRealBalance && nameReady && pinReady) {
            submitBtn.style.display = 'block';
        } else {
            submitBtn.style.display = 'none';
        }
    }

    function clearVerifiedAccount() {
        verifiedKey = "";
        accountNameInput.value = "";
        nameGroupField.style.display = 'none';
    }

    async function triggerAccountVerification() {
        const bankCode = bankCodeSelect.value;
        const accountNumber = accountNumberInput.value;
        const currentKey = bankCode + ':' + accountNumber;

        if (verifiedKey && verifiedKey !== currentKey) {
            clearVerifiedAccount();
        }
        checkFormValidity();

        if (!bankCode || accountNumber.length !== 10) {
            verificationLoader.style.display = 'none';
            return;
        }

        const ticket = ++verifyCounter;
        verificationLoader.style.display = 'block';
        clearVerifiedAccount();

        const data = await callApi({ action: 'verify_account', bank_code: bankCode, account_number: accountNumber });

        if (ticket !== verifyCounter) return;
        verificationLoader.style.display = 'none';

        if (data.success && data.account_name) {
            verifiedKey = currentKey;
            nameGroupField.style.display = 'block';
            accountNameInput.value = data.account_name;
            checkFormValidity();
        } else {
            showToast(data.message || 'Unable to resolve account identity.');
        }
    }

    function verifyPinPattern() {
        for (let i = 1; i <= 4; i++) {
            const box = document.getElementById('p' + i);
            const status = document.getElementById('s' + i);
            if (!box || !status) continue;
            if (box.value !== "") {
                if (box.value === userSecurePin[i - 1]) {
                    status.className = 'status-icon valid';
                    status.innerHTML = '✔';
                } else {
                    status.className = 'status-icon invalid';
                    status.innerHTML = '✖';
                }
            } else {
                status.className = 'status-icon';
                status.innerHTML = "";
            }
        }
        checkFormValidity();
    }

    function resetForm() {
        amountInput.value = "";
        accountNumberInput.value = "";
        bankCodeSelect.value = "";
        clearVerifiedAccount();
        resetPinBoxes();
        submitBtn.style.display = 'none';
        feeCalculationDisplay.className = 'fee-display';
        feeCalculationDisplay.textContent = 'You will receive: ₦0.00 (Withdrawal Fee 1%: ₦0.00)';
    }

    async function submitWithdrawal() {
        if (isSubmitting) return;

        const amt = parseFloat(amountInput.value) || 0;
        if (amt <= 0 || amt > cachedRealBalance) {
            showToast('Enter a valid amount within your wallet balance.');
            return;
        }

        isSubmitting = true;
        submitBtn.disabled = true;
        showLoader('Processing');

        const payload = {
            action: 'request_withdraw',
            uuid: currentUserId,
            pin: getCompiledPin(),
            amount: amt,
            bank_code: bankCodeSelect.value,
            bank_name: bankCodeSelect.options[bankCodeSelect.selectedIndex].text,
            account_number: accountNumberInput.value
        };

        const data = await callApi(payload);
        await hideLoader();

        isSubmitting = false;
        submitBtn.disabled = false;

        if (data.success && data.withdrawal) {
            pendingWithdrawal = data.withdrawal;
            historyList = [data.withdrawal].concat(historyList.filter((item) => item.id !== data.withdrawal.id));
            historyLoaded = true;
            resetForm();
            applyViewState(true);
            showToast('Withdrawal request successful. Payment may take a few minutes.', 'success');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        if (data.pending) {
            pendingWithdrawal = data.pending;
            resetForm();
            applyViewState(false);
        }

        showToast(data.message || 'Unable to submit your request. Please try again later.');
        checkFormValidity();
    }

    amountInput.addEventListener('input', () => {
        updateFeeDisplay();
        checkFormValidity();
    });

    bankCodeSelect.addEventListener('change', triggerAccountVerification);

    accountNumberInput.addEventListener('input', () => {
        accountNumberInput.value = accountNumberInput.value.replace(/\D/g, '').slice(0, 10);
        triggerAccountVerification();
    });

    pinIds.forEach((id, index) => {
        const el = document.getElementById(id);
        if (!el) return;

        el.addEventListener('input', () => {
            el.value = el.value.replace(/\D/g, '').slice(0, 1);
            if (el.value.length === 1 && index < 3) {
                const next = document.getElementById(pinIds[index + 1]);
                if (next) next.focus();
            }
            verifyPinPattern();
        });

        el.addEventListener('keydown', (event) => {
            if (event.key === 'Backspace' && el.value === "" && index > 0) {
                const prev = document.getElementById(pinIds[index - 1]);
                if (prev) prev.focus();
            }
        });
    });

    submitBtn.addEventListener('click', submitWithdrawal);
    historyBtn.addEventListener('click', openHistory);
    historyClose.addEventListener('click', closeHistory);
    historyOverlay.addEventListener('click', (event) => {
        if (event.target === historyOverlay) closeHistory();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeHistory();
    });

    async function initializeWithdrawalPage() {
        showLoader('Loading');
        const safety = setTimeout(() => {
            if (loadingScene && !loadingScene.classList.contains('hide')) hideLoader();
        }, 12000);

        const profileOk = await fetchUserProfile();
        if (profileOk) {
            await fetchOverview();
            applyViewState(false);
        }

        clearTimeout(safety);
        await hideLoader();
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initializeWithdrawalPage);
    } else {
        initializeWithdrawalPage();
    }
})();