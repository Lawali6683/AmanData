import { mountShell, showLoader, hideLoader, reveal, toast, escapeHtml, money, confirmDialog, apiPost } from './uix.js';
import { requireSession, accessToken } from './auth.js';
import { supabase } from './client.js';

(function () {
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

    function friendly(error) {
        const text = (error && error.message) || 'Something went wrong. Try again.';
        if (error && (error.code === 'PGRST202' || /Could not find the function|schema cache/i.test(text))) {
            return 'The withdrawal functions are not installed. Run withdraw.sql in the Supabase SQL editor.';
        }
        if (/Not allowed/i.test(text)) return 'You do not have access to this page.';
        return text;
    }

    async function rpc(name, args) {
        try {
            const r = await supabase.rpc(name, args || {});
            if (r.error) return { ok: false, message: friendly(r.error) };
            return { ok: true, data: r.data };
        } catch (err) {
            return { ok: false, message: 'Network error. Check your connection and try again.' };
        }
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

    function showError(message) {
        list.innerHTML = '';
        $('emptyState').classList.add('hidden');
        $('pendingCount').textContent = '-';
        $('errorText').textContent = message || 'Could not load withdrawals.';
        $('errorState').classList.remove('hidden');
    }

    function hideError() {
        $('errorState').classList.add('hidden');
    }

    async function loadDashboard(options) {
        const o = options || {};
        if (loading) return;
        loading = true;
        if (o.loader) showLoader();
        const r = await rpc('admin_withdraw_dashboard');
        if (o.loader) hideLoader();
        loading = false;
        if (!r.ok) {
            if (!o.quiet) showError(r.message);
            return;
        }
        hideError();
        const d = r.data || {};
        items = Array.isArray(d.pending) ? d.pending : [];
        renderStats(d.stats || {});
        renderPending();
    }

    async function sendEmail(withdrawal, balance) {
        const token = await accessToken();
        if (!token) return;
        const r = await apiPost(PAY_ENDPOINT, token, {
            token: token,
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
        if (r.data && r.data.success) {
            toast('Confirmation email sent to ' + withdrawal.email, 'ok');
        } else {
            toast('Payment saved, but the email could not be sent. ' + ((r.data && r.data.message) || ''), 'err');
        }
    }

    async function runAction(name, id, fallback) {
        running = true;
        showLoader();
        const r = await rpc(name, { p_id: String(id) });
        hideLoader();
        running = false;
        if (!r.ok) {
            toast(r.message || fallback, 'err');
            loadDashboard({ quiet: true });
            return null;
        }
        items = items.filter((x) => String(x.id) !== String(id));
        renderPending();
        return r.data || {};
    }

    async function complete(id) {
        const item = items.find((x) => String(x.id) === String(id));
        if (!item) return;
        const ok = await confirmDialog({
            title: 'Confirm payment',
            html: 'Have you paid <strong>₦' + escapeHtml(money(item.net_amount)) + '</strong> to <strong>' + escapeHtml(item.full_name) + '</strong>?<br>₦' + escapeHtml(money(item.amount)) + ' (including the fee) will be deducted from the wallet.',
            okLabel: 'Yes, I paid',
            noLabel: 'Not yet'
        });
        if (!ok) return;
        const data = await runAction('admin_complete_withdrawal', id, 'Payment could not be completed.');
        if (!data) return;
        toast('Payment completed for ' + item.full_name, 'ok');
        sendEmail(data.withdrawal || item, data.new_balance);
        loadDashboard({ quiet: true });
    }

    async function remove(id) {
        const item = items.find((x) => String(x.id) === String(id));
        if (!item) return;
        const ok = await confirmDialog({
            title: 'Delete request',
            html: 'Delete the withdrawal request of <strong>' + escapeHtml(item.full_name) + '</strong>? They will be able to make a new request.',
            okLabel: 'Delete',
            noLabel: 'Keep',
            danger: true
        });
        if (!ok) return;
        const data = await runAction('admin_cancel_withdrawal', id, 'Could not delete the request.');
        if (!data) return;
        toast('Withdrawal request deleted.', 'ok');
        loadDashboard({ quiet: true });
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

    $('btnRetry').addEventListener('click', () => { if (!running) loadDashboard({ loader: true }); });
    $('btnBack').addEventListener('click', () => { window.location.href = 'admin.html'; });
    $('btnRefresh').addEventListener('click', () => { if (!running) loadDashboard({ loader: true }); });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !running) loadDashboard({ quiet: true });
    });

    async function initialize() {
        try {
            const session = await requireSession();
            if (!session) return;
            await loadDashboard({});
            timer = setInterval(() => { if (!document.hidden && !running) loadDashboard({ quiet: true }); }, 60000);
        } finally {
            reveal(container, 1200);
        }
    }

    initialize();
})();
