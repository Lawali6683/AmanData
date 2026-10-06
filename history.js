import { supabase } from './supabase.js';

(function () {
    const API_ENDPOINT = '/api/withdraw';
    const REQ_PASS = '@haruna66';
    const SESSION_KEY = 'puredata_user_session';

    const scene = document.getElementById('scene');
    const liquid = document.getElementById('liquid');
    const brand = document.getElementById('brand');
    const loaderLogo = document.getElementById('loaderLogo');
    const bg = document.getElementById('bg');
    const appContainer = document.getElementById('appContainer');
    const historyList = document.getElementById('historyList');
    const tabWallet = document.getElementById('tabWallet');
    const tabPaid = document.getElementById('tabPaid');
    const tabPending = document.getElementById('tabPending');
    const pendingBadge = document.getElementById('pendingBadge');
    const sumBalance = document.getElementById('sumBalance');
    const sumIn = document.getElementById('sumIn');
    const sumOut = document.getElementById('sumOut');
    const detailsOverlay = document.getElementById('detailsOverlay');
    const btnCloseDetails = document.getElementById('btnCloseDetails');
    const detTitle = document.getElementById('detTitle');
    const detRows = document.getElementById('detRows');
    const toastContainer = document.getElementById('toastContainer');
    const toastMessage = document.getElementById('toastMessage');

    let userUUID = null;
    let walletTransactions = [];
    let withdrawals = [];
    let walletError = false;
    let withdrawError = false;
    let activeTab = 'wallet';
    let loaderHidden = false;
    let toastTimer = null;

    function readSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (err) {
            return null;
        }
    }

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
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

    function parseAmount(value) {
        const number = parseFloat(String(value === undefined || value === null ? 0 : value).replace(/,/g, ''));
        return isFinite(number) ? number : 0;
    }

    function parseDate(value) {
        if (!value) return null;
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date;
    }

    function formatShortDate(value) {
        const date = parseDate(value);
        if (!date) return value ? String(value) : '-';
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatLongDate(value) {
        const date = parseDate(value);
        if (!date) return value ? String(value) : '-';
        return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    function formatTime(value) {
        const date = parseDate(value);
        if (!date) return '-';
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function showToast(message) {
        if (!toastMessage || !toastContainer) return;
        toastMessage.textContent = message;
        toastContainer.classList.add('active');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toastContainer.classList.remove('active');
        }, 3200);
    }

    function startLoader() {
        setTimeout(() => {
            if (liquid) liquid.classList.add('fill');
        }, 300);
    }

    function hideLoader() {
        if (loaderHidden) return;
        loaderHidden = true;
        if (liquid) {
            liquid.style.transition = 'height 1.8s cubic-bezier(0.4, 0, 0.2, 1)';
            liquid.style.height = '0%';
        }
        if (brand) brand.classList.add('hide');
        if (loaderLogo) loaderLogo.classList.add('hide');
        if (bg) bg.classList.add('show');

        setTimeout(() => {
            if (scene) scene.classList.add('hidden');
            if (appContainer) appContainer.classList.add('ready');
        }, 600);
    }

    function normalizeTransaction(tx, index) {
        const source = tx && typeof tx === 'object' ? tx : {};
        const rawType = String(source.type || source.transaction_type || source.category || '').toLowerCase();
        const direction = String(source.direction || source.flow || '').toLowerCase();
        const creditPattern = /deposit|credit|fund|top.?up|refund|bonus|reward|commission|cashback|referral|received|reversal/;
        const isCredit = direction === 'credit' || direction === 'in' || creditPattern.test(rawType);

        const title = source.title || source.description || source.service || source.narration || source.type || source.transaction_type || 'Transaction';
        const dateValue = source.created_at || source.date || source.timestamp || source.time || source.createdAt || source.transaction_date || '';
        const parsed = parseDate(dateValue);

        const rawStatus = String(source.status || 'success').toLowerCase();
        let statusKind = 'ok';
        let statusText = 'Success';
        if (/pend|process|wait/.test(rawStatus)) {
            statusKind = 'wait';
            statusText = 'Pending';
        } else if (/fail|declin|cancel|reject|error/.test(rawStatus)) {
            statusKind = 'bad';
            statusText = 'Failed';
        }

        return {
            index: index,
            isCredit: isCredit,
            title: String(title),
            typeLabel: rawType ? rawType.toUpperCase() : (isCredit ? 'DEPOSIT' : 'SPENDING'),
            amount: parseAmount(source.amount !== undefined ? source.amount : source.value),
            dateValue: dateValue,
            sortKey: parsed ? parsed.getTime() : 0,
            reference: source.reference || source.ref || source.transaction_id || source.id || '',
            statusKind: statusKind,
            statusText: statusText
        };
    }

    async function loadWalletData() {
        walletError = false;
        try {
            const { data, error } = await supabase
                .from('user_profiles')
                .select('user_data')
                .eq('id', userUUID);

            if (error) throw error;

            const profile = data && data.length > 0 ? data[0] : null;
            const userData = profile && profile.user_data ? profile.user_data : {};
            const list = Array.isArray(userData.transactions) ? userData.transactions : [];

            walletTransactions = list
                .map(normalizeTransaction)
                .sort((a, b) => (b.sortKey - a.sortKey) || (b.index - a.index));

            sumBalance.textContent = money(parseAmount(userData.user_balance));
        } catch (err) {
            walletError = true;
            walletTransactions = [];
            showToast('Unable to load your wallet history.');
        }

        updateSummary();
    }

    async function loadWithdrawals() {
        withdrawError = false;
        try {
            const res = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'overview', uuid: userUUID, req_pass: REQ_PASS })
            });
            const data = await res.json();
            if (!data || !data.success || !Array.isArray(data.history)) {
                throw new Error('Invalid response');
            }
            withdrawals = data.history;
        } catch (err) {
            withdrawError = true;
            withdrawals = [];
        }
        updatePendingBadge();
    }

    function updateSummary() {
        let totalIn = 0;
        let totalOut = 0;
        walletTransactions.forEach((tx) => {
            if (tx.statusKind !== 'ok') return;
            if (tx.isCredit) totalIn += tx.amount;
            else totalOut += tx.amount;
        });
        sumIn.textContent = money(totalIn);
        sumOut.textContent = money(totalOut);
    }

    function pendingItems() {
        return withdrawals.filter((item) => item.status === 'pending' || item.status === 'processing');
    }

    function paidItems() {
        return withdrawals.filter((item) => item.status === 'completed' || item.status === 'cancelled');
    }

    function updatePendingBadge() {
        const count = pendingItems().length;
        pendingBadge.textContent = String(count);
        pendingBadge.classList.toggle('visible', count > 0);
    }

    function renderEmpty(icon, title, description, retry) {
        historyList.innerHTML =
            '<div class="empty-state">' +
                '<i class="fa-solid ' + icon + ' empty-icon"></i>' +
                '<h3 class="empty-title">' + escapeHtml(title) + '</h3>' +
                '<p class="empty-desc">' + escapeHtml(description) + '</p>' +
                (retry ? '<button type="button" class="btn-retry" id="retryBtn">Try Again</button>' : '') +
            '</div>';

        if (retry) {
            const button = document.getElementById('retryBtn');
            if (button) button.addEventListener('click', retry);
        }
    }

    function walletCard(tx) {
        const kind = tx.isCredit ? 'deposit' : 'spending';
        const icon = tx.isCredit ? 'fa-arrow-down' : 'fa-arrow-up';
        const prefix = tx.isCredit ? '+' : '-';

        const card = document.createElement('div');
        card.className = 'transaction-card';
        card.innerHTML =
            '<div class="tx-left">' +
                '<div class="tx-icon-frame ' + kind + '"><i class="fa-solid ' + icon + '"></i></div>' +
                '<div class="tx-meta">' +
                    '<span class="tx-title">' + escapeHtml(tx.title) + '</span>' +
                    '<span class="tx-date">' + escapeHtml(formatShortDate(tx.dateValue)) + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="tx-right">' +
                '<span class="tx-amount ' + kind + '">' + prefix + '₦' + escapeHtml(money(tx.amount)) + '</span>' +
                '<span class="tx-status ' + tx.statusKind + '">' + escapeHtml(tx.statusText) + '</span>' +
            '</div>';
        card.addEventListener('click', () => openWalletDetails(tx));
        return card;
    }

    function withdrawalStatus(item) {
        if (item.status === 'completed') return { kind: 'ok', text: 'Paid', icon: 'spending' };
        if (item.status === 'cancelled') return { kind: 'bad', text: 'Declined', icon: 'spending' };
        return { kind: 'wait', text: 'Pending', icon: 'waiting' };
    }

    function withdrawalCard(item) {
        const info = withdrawalStatus(item);
        const dateValue = item.status === 'completed' && item.completed_at ? item.completed_at : item.created_at;
        const iconName = item.status === 'completed' ? 'fa-building-columns' : (item.status === 'cancelled' ? 'fa-ban' : 'fa-hourglass-half');

        const card = document.createElement('div');
        card.className = 'transaction-card';
        card.innerHTML =
            '<div class="tx-left">' +
                '<div class="tx-icon-frame ' + info.icon + '"><i class="fa-solid ' + iconName + '"></i></div>' +
                '<div class="tx-meta">' +
                    '<span class="tx-title">Withdrawal to ' + escapeHtml(item.bank_name || 'Bank') + '</span>' +
                    '<span class="tx-date">' + escapeHtml(formatShortDate(dateValue)) + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="tx-right">' +
                '<span class="tx-amount spending">₦' + escapeHtml(money(item.net_amount)) + '</span>' +
                '<span class="tx-status ' + info.kind + '">' + escapeHtml(info.text) + '</span>' +
            '</div>';
        card.addEventListener('click', () => openWithdrawalDetails(item));
        return card;
    }

    function renderActiveTab() {
        historyList.innerHTML = '';

        if (activeTab === 'wallet') {
            if (walletError) {
                renderEmpty('fa-triangle-exclamation', 'Unable To Load', 'We could not load your wallet history right now. Please try again.', refreshWallet);
                return;
            }
            if (walletTransactions.length === 0) {
                renderEmpty('fa-wallet', 'No Wallet History', 'You have not added money to your wallet or spent any money yet.');
                return;
            }
            walletTransactions.forEach((tx) => historyList.appendChild(walletCard(tx)));
            return;
        }

        if (withdrawError) {
            renderEmpty('fa-triangle-exclamation', 'Unable To Load', 'We could not load your withdrawals right now. Please try again.', refreshWithdrawals);
            return;
        }

        if (activeTab === 'paid') {
            const items = paidItems();
            if (items.length === 0) {
                renderEmpty('fa-building-columns', 'No Withdrawals Yet', 'Withdrawals that have been paid to your bank account will appear here.');
                return;
            }
            items.forEach((item) => historyList.appendChild(withdrawalCard(item)));
            return;
        }

        const items = pendingItems();
        if (items.length === 0) {
            renderEmpty('fa-hourglass-half', 'No Pending Withdrawal', 'When you request a withdrawal it will stay here until it is paid.');
            return;
        }
        items.forEach((item) => historyList.appendChild(withdrawalCard(item)));
    }

    async function refreshWallet() {
        await loadWalletData();
        renderActiveTab();
    }

    async function refreshWithdrawals() {
        await loadWithdrawals();
        renderActiveTab();
    }

    function detailRow(label, value, colorClass) {
        return '<div class="detail-row"><span class="detail-row-label">' + escapeHtml(label) + '</span>' +
            '<span class="detail-row-val' + (colorClass ? ' ' + colorClass : '') + '">' + escapeHtml(value) + '</span></div>';
    }

    function statusColor(kind) {
        if (kind === 'ok') return 'success-color';
        if (kind === 'wait') return 'warning-color';
        return 'danger-color';
    }

    function openOverlay(title, rowsHtml) {
        detTitle.textContent = title;
        detRows.innerHTML = rowsHtml;
        detailsOverlay.classList.add('active');
    }

    function openWalletDetails(tx) {
        const prefix = tx.isCredit ? '+' : '-';
        const rows = [
            detailRow('Transaction Type', tx.typeLabel),
            detailRow('Description', tx.title),
            detailRow('Amount', prefix + '₦' + money(tx.amount)),
            detailRow('Reference ID', tx.reference ? String(tx.reference) : 'N/A'),
            detailRow('Execution Date', formatLongDate(tx.dateValue)),
            detailRow('Execution Time', formatTime(tx.dateValue)),
            detailRow('Status', tx.statusText, statusColor(tx.statusKind))
        ];
        openOverlay('Transaction Receipt', rows.join(''));
    }

    function openWithdrawalDetails(item) {
        const info = withdrawalStatus(item);
        const rows = [
            detailRow('Transaction Type', 'WITHDRAWAL'),
            detailRow('Amount Requested', '₦' + money(item.amount)),
            detailRow('Fee (1%)', '₦' + money(item.fee)),
            detailRow(item.status === 'completed' ? 'Amount Paid' : 'Amount To Receive', '₦' + money(item.net_amount)),
            detailRow('Bank', item.bank_name || '-'),
            detailRow('Account Number', item.account_number || '-'),
            detailRow('Account Name', item.account_name || '-'),
            detailRow('Reference ID', item.reference || 'N/A'),
            detailRow('Requested On', formatLongDate(item.created_at) + ', ' + formatTime(item.created_at))
        ];
        if (item.status === 'completed' && item.completed_at) {
            rows.push(detailRow('Paid On', formatLongDate(item.completed_at) + ', ' + formatTime(item.completed_at)));
        }
        rows.push(detailRow('Status', info.text, statusColor(info.kind)));
        openOverlay('Withdrawal Receipt', rows.join(''));
    }

    function closeOverlay() {
        detailsOverlay.classList.remove('active');
    }

    function switchTab(tab) {
        activeTab = tab;
        tabWallet.classList.toggle('active', tab === 'wallet');
        tabPaid.classList.toggle('active', tab === 'paid');
        tabPending.classList.toggle('active', tab === 'pending');
        renderActiveTab();
    }

    tabWallet.addEventListener('click', () => switchTab('wallet'));
    tabPaid.addEventListener('click', () => switchTab('paid'));
    tabPending.addEventListener('click', () => switchTab('pending'));
    btnCloseDetails.addEventListener('click', closeOverlay);
    detailsOverlay.addEventListener('click', (event) => {
        if (event.target === detailsOverlay) closeOverlay();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeOverlay();
    });

    async function initialize() {
        startLoader();
        const safety = setTimeout(hideLoader, 10000);

        const session = readSession();
        const id = session ? (session.userId || session.id || (session.user && session.user.id)) : null;

        if (!id) {
            localStorage.removeItem(SESSION_KEY);
            window.location.replace('register.html');
            return;
        }

        userUUID = String(id);

        try {
            await Promise.all([loadWalletData(), loadWithdrawals()]);
            renderActiveTab();
        } catch (err) {
            renderEmpty('fa-wallet', 'No Wallet History', 'You have not added money to your wallet or spent any money yet.');
        } finally {
            clearTimeout(safety);
            setTimeout(hideLoader, 1600);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();