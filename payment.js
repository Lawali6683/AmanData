import { mountShell, showLoader, hideLoader, reveal, toast, escapeHtml, money, confirmDialog } from './uix.js';
import { requireSession, accessToken } from './auth.js';

(function () {
    const API_ENDPOINT = '/api/withdraw';
    const PAY_ENDPOINT = '/pay';
    const OVERDUE_MS = 24 * 60 * 60 * 1000;

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    const list = $('pendingList');

    let items = [];
    let loading = false;
    let running = false;
    let timer = null;

    function formatDate(value) {
        const d = new Date(value);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function ageText(value) {
        const diff = Date.now() - new Date(value).getTime();
        if (!isFinite(diff) || diff < 0) return 'just now';
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return minutes + ' min ago';
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + 'h ' + (minutes % 60) + 'm ago';
        return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h ago';
    }

    async function callApi(url, payload) {
        const token = await accessToken();
        if (!token) {
            window.location.replace('admin.html');
            return { success: false, expired: true, message: 'Session expired.' };
        }
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify(Object.assign({}, payload, { token: token }))
            });
            const data = await res.json();
            if (res.status === 401 || res.status === 403) {
                return { success: false, expired: true, message: (data && data.message) || 'Access denied.' };
            }
            return data && typeof data === 'object' ? data : { success: false, message: 'Invalid server response.' };
        } catch (err) {
            return { success: false, message: 'Network error. Check your connection and try again.' };
        }
    }

    function expire(message) {
        toast(message || 'Session expired. Sign in again.', 'err');
        setTimeout(() => window.location.replace('admin.html'), 1500);
    }

    async function copyText(text) {
        const value = String(text);
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(value);
                return true;
            }
        } catch (err) {}
        try {
            const area = document.createElement('textarea');
            area.value = value;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            const ok = document.execCommand('copy');
            area.remove();
            return ok;
        } catch (err) {
            return false;
        }
    }

    function copyButton(value, label) {
        return '<button type="button" class="copy-btn" data-copy="' + escapeHtml(value) + '" data-label="' + escapeHtml(label) + '" aria-label="Copy ' + escapeHtml(label) + '"><i class="fa-regular fa-copy"></i></button>';
    }

    function card(item) {
        const overdue = Date.now() - new Date(item.created_at).getTime() > OVERDUE_MS;
        const low = Number(item.current_balance) < Number(item.amount);
        const net = Number(item.net_amount).toFixed(2);
        const id = escapeHtml(item.id);
        return '<article class="w-card' + (overdue ? ' overdue' : '') + '" data-id="' + id + '">' +
            '<div class="w-top"><div class="w-name">' + escapeHtml(item.full_name || 'Unknown user') + '</div>' +
            (overdue ? '<span class="badge bad"><i class="fa-solid fa-triangle-exclamation"></i> Over 24h</span>' : '') + '</div>' +
            '<div class="w-age"><i class="fa-regular fa-clock"></i> ' + escapeHtml(ageText(item.created_at)) + ' • ' + escapeHtml(formatDate(item.created_at)) + '</div>' +
            (low ? '<div class="badge low"><i class="fa-solid fa-circle-exclamation"></i> Wallet balance is lower than the amount</div>' : '') +
            '<div class="w-row"><span class="k">Email</span><span class="v">' + escapeHtml(item.email || '-') + (item.email ? copyButton(item.email, 'email') : '') + '</span></div>' +
            '<div class="w-row"><span class="k">Balance</span><span class="v">₦' + escapeHtml(money(item.current_balance)) + '</span></div>' +
            '<div class="w-row"><span class="k">Account number</span><span class="v">' + escapeHtml(item.account_number) + copyButton(item.account_number, 'account number') + '</span></div>' +
            '<div class="w-row"><span class="k">Account name</span><span class="v">' + escapeHtml(item.account_name || '-') + '</span></div>' +
            '<div class="w-row"><span class="k">Bank</span><span class="v">' + escapeHtml(item.bank_name) + '</span></div>' +
            '<div class="w-row"><span class="k">Requested</span><span class="v">₦' + escapeHtml(money(item.amount)) + ' <small class="muted">(fee ₦' + escapeHtml(money(item.fee)) + ')</small></span></div>' +
            '<div class="w-row"><span class="k">Amount to pay</span><span class="v big">₦' + escapeHtml(money(item.net_amount)) + copyButton(net, 'amount') + '</span></div>' +
            '<div class="w-actions">' +
            '<button type="button" class="btn-small danger" data-action="delete" data-id="' + id + '"><i class="fa-solid fa-trash-can"></i> Delete</button>' +
            '<button type="button" class="btn-small success" data-action="complete" data-id="' + id + '"' + (low ? ' disabled' : '') + '><i class="fa-solid fa-circle-check"></i> Complete payment</button>' +
            '</div></article>';
    }

    function renderStats(stats) {
        $('statUsers').textContent = Number(stats.total_users || 0).toLocaleString('en-NG');
        $('statWallet').textContent = '₦' + money(stats.total_wallet);
        $('statFunded').textContent = Number(stats.users_with_funds || 0).toLocaleString('en-NG');
    }

    function renderPending() {
        $('pendingCount').textContent = items.length + ' pending';
        $('emptyState').classList.toggle('hidden', items.length > 0);
        list.innerHTML = items.map(card).join('');
    }

    async function loadDashboard(silent) {
        if (loading) return;
        loading = true;
        if (!silent) showLoader();
        const data = await callApi(API_ENDPOINT, { action: 'admin_dashboard' });
        if (!silent) hideLoader();
        loading = false;
        if (data.expired) {
            expire(data.message);
            return;
        }
        if (!data.success) {
            if (!silent) toast(data.message || 'Could not load withdrawals.', 'err');
            return;
        }
        items = Array.isArray(data.pending) ? data.pending : [];
        renderStats(data.stats || {});
        renderPending();
    }

    async function sendEmail(withdrawal, balance) {
        const data = await callApi(PAY_ENDPOINT, {
            email: withdrawal.email,
            full_name: withdrawal.full_name,
            time: withdrawal.completed_at || new Date().toISOString(),
            amount: withdrawal.amount,
            fee: withdrawal.fee,
            net_amount: withdrawal.net_amount,
            account_number: withdrawal.account_number,
            account_name: withdrawal.account_name,
            bank_name: withdrawal.bank_name,
            reference: withdrawal.reference,
            balance: balance
        });
        if (data && data.success) toast('Confirmation email sent to ' + withdrawal.email, 'ok');
        else toast('Payment saved, but the email could not be sent.', 'err');
    }

    async function runAction(action, id, busyMessage) {
        running = true;
        showLoader();
        const data = await callApi(API_ENDPOINT, { action: action, id: id });
        hideLoader();
        running = false;
        if (data.expired) {
            expire(data.message);
            return null;
        }
        if (!data.success) {
            toast(data.message || busyMessage, 'err');
            loadDashboard(true);
            return null;
        }
        items = items.filter((x) => x.id !== id);
        renderPending();
        return data;
    }

    async function complete(id) {
        const item = items.find((x) => x.id === id);
        if (!item) return;
        const ok = await confirmDialog({
            title: 'Confirm payment',
            html: 'Have you paid <strong>₦' + escapeHtml(money(item.net_amount)) + '</strong> to <strong>' + escapeHtml(item.full_name) + '</strong>?<br>₦' + escapeHtml(money(item.amount)) + ' (including the fee) will be deducted from the wallet.',
            okLabel: 'Yes, I paid',
            noLabel: 'Not yet'
        });
        if (!ok) return;
        const data = await runAction('admin_complete', id, 'Payment could not be completed.');
        if (!data) return;
        toast('Payment completed for ' + item.full_name, 'ok');
        sendEmail(data.withdrawal || item, data.new_balance);
        loadDashboard(true);
    }

    async function remove(id) {
        const item = items.find((x) => x.id === id);
        if (!item) return;
        const ok = await confirmDialog({
            title: 'Delete request',
            html: 'Delete the withdrawal request of <strong>' + escapeHtml(item.full_name) + '</strong>? They will be able to make a new request.',
            okLabel: 'Delete',
            noLabel: 'Keep',
            danger: true
        });
        if (!ok) return;
        const data = await runAction('admin_delete', id, 'Could not delete the request.');
        if (!data) return;
        toast('Withdrawal request deleted.', 'ok');
        loadDashboard(true);
    }

    list.addEventListener('click', async (event) => {
        const copyBtn = event.target.closest('.copy-btn');
        if (copyBtn) {
            if (await copyText(copyBtn.getAttribute('data-copy'))) {
                copyBtn.classList.add('done');
                copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                toast('Copied ' + copyBtn.getAttribute('data-label') + '.', 'ok');
                setTimeout(() => {
                    copyBtn.classList.remove('done');
                    copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
                }, 1500);
            } else {
                toast('Could not copy. Copy it by hand.', 'err');
            }
            return;
        }
        const btn = event.target.closest('[data-action]');
        if (!btn || running) return;
        const id = btn.getAttribute('data-id');
        if (btn.getAttribute('data-action') === 'complete') complete(id);
        else remove(id);
    });

    $('btnBack').addEventListener('click', () => { window.location.href = 'admin.html'; });
    $('btnRefresh').addEventListener('click', () => { if (!running) loadDashboard(false); });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !running) loadDashboard(true);
    });

    async function initialize() {
        try {
            const session = await requireSession();
            if (!session) return;
            await loadDashboard(true);
            timer = setInterval(() => { if (!document.hidden && !running) loadDashboard(true); }, 60000);
        } finally {
            reveal(container, 1200);
        }
    }

    initialize();
})();