import { mountShell, showLoader, hideLoader, reveal, toast, escapeHtml, money, confirmDialog, apiPost } from './uix.js';
import { requireSession, accessToken, signOut } from './auth.js';

(function () {
    const API_ENDPOINT = '/api/reseller';
    const HOME_PAGE = 'admin.html';

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    const bizInput = $('business');
    const phoneInput = $('phone');

    let busy = false;
    let currentKey = '';

    async function call(payload) {
        const token = await accessToken();
        if (!token) {
            window.location.reload();
            return { success: false, message: 'Please sign in again.' };
        }
        const r = await apiPost(API_ENDPOINT, token, payload);
        if (r.status === 401) setTimeout(() => window.location.reload(), 2200);
        return r.data;
    }

    async function copyText(text) {
        let ok = false;
        try {
            await navigator.clipboard.writeText(text);
            ok = true;
        } catch (err) {
            try {
                const area = document.createElement('textarea');
                area.value = text;
                area.setAttribute('readonly', '');
                area.style.position = 'fixed';
                area.style.opacity = '0';
                document.body.appendChild(area);
                area.select();
                ok = document.execCommand('copy');
                area.remove();
            } catch (e) {
                ok = false;
            }
        }
        toast(ok ? 'Copied.' : 'Could not copy. Copy it by hand.', ok ? 'ok' : 'err');
    }

    function showKey(key) {
        currentKey = key;
        $('keyBox').textContent = key;
        $('keyCard').classList.remove('hidden');
        $('keyCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function renderDocs(account) {
        const base = window.location.origin + '/api/v1';
        const id = account.api_id;
        $('docRequest').textContent =
            'POST ' + base + '/data\nAuthorization: Bearer YOUR_API_KEY\nX-API-ID: ' + id + '\nContent-Type: application/json\n\n' +
            '{\n  "network": "mtn | airtel | glo | 9mobile",\n  "phone": "08012345678",\n  "plan_id": "PLAN_ID_FROM_PLANS_LIST",\n  "request_id": "order-1001"\n}';
        $('docSuccess').textContent =
            '{\n  "success": true,\n  "status": "delivered",\n  "message": "1GB has been sent to 08012345678.",\n  "reference": "order-1001",\n  "network": "MTN",\n  "plan": "1GB",\n  "amount": 300,\n  "balance": 4700\n}';
        $('docError').textContent =
            '{\n  "success": false,\n  "status": "failed",\n  "message": "Your wallet balance is not enough.",\n  "reference": "order-1001"\n}';
        $('docOrder').textContent =
            'GET ' + base + '/order?request_id=order-1001\nAuthorization: Bearer YOUR_API_KEY\nX-API-ID: ' + id + '\n\nstatus: delivered | processing | failed';
        $('docPlans').textContent =
            'GET ' + base + '/plans?network=mtn\nAuthorization: Bearer YOUR_API_KEY\nX-API-ID: ' + id;
    }

    function renderOrders(orders) {
        const list = $('orderList');
        list.innerHTML = '';
        if (!orders.length) {
            list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-receipt empty-icon"></i><h3 class="empty-title">No orders yet</h3><p class="empty-desc">Your API orders will appear here.</p></div>';
            return;
        }
        orders.forEach((o) => {
            const kind = o.status === 'delivered' ? 'ok' : (o.status === 'failed' ? 'bad' : 'wait');
            const date = new Date(o.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
            const card = document.createElement('div');
            card.className = 'transaction-card';
            card.innerHTML =
                '<div class="tx-left"><div class="tx-icon-frame"><i class="fa-solid fa-wifi"></i></div>' +
                '<div class="tx-meta"><span class="tx-title">' + escapeHtml(o.plan_name) + ' • ' + escapeHtml(o.phone) + '</span>' +
                '<span class="tx-date">' + escapeHtml(date) + ' • ' + escapeHtml(o.reference) + '</span></div></div>' +
                '<div class="tx-right"><span class="tx-amount">₦' + escapeHtml(money(o.price)) + '</span>' +
                '<span class="tx-status ' + kind + '">' + escapeHtml(o.status) + '</span></div>';
            list.appendChild(card);
        });
    }

    async function load() {
        const result = await call({ action: 'dashboard' });
        if (result && result.needs_register) {
            $('mainArea').classList.add('hidden');
            $('regCard').classList.remove('hidden');
            return;
        }
        if (!result || !result.success) {
            toast((result && result.message) || 'Could not load your dashboard.', 'err');
            return;
        }
        const a = result.account;
        $('regCard').classList.add('hidden');
        $('mainArea').classList.remove('hidden');
        $('bizName').textContent = a.business_name;
        $('sumBalance').textContent = money(a.balance);
        $('sumApiId').textContent = a.api_id;
        $('sumStatus').textContent = String(a.status || '').toUpperCase();
        $('credId').textContent = a.api_id;
        $('credKey').textContent = a.key_prefix + '••••••••••••';
        renderDocs(a);
        renderOrders(result.orders || []);
        let fresh = null;
        try {
            fresh = sessionStorage.getItem('amk_new_key');
            sessionStorage.removeItem('amk_new_key');
        } catch (err) {}
        if (fresh) showKey(fresh);
    }

    async function register() {
        if (busy) return;
        const business = bizInput.value.trim();
        if (business.length < 2) {
            toast('Enter your business name.', 'err');
            bizInput.focus();
            return;
        }
        if (!/^0\d{10}$/.test(phoneInput.value)) {
            toast('Enter an 11-digit phone number starting with 0.', 'err');
            phoneInput.focus();
            return;
        }
        busy = true;
        showLoader();
        const result = await call({ action: 'register', business_name: business, phone: phoneInput.value });
        if (result && result.success) {
            try { sessionStorage.setItem('amk_new_key', result.api_key); } catch (err) {}
            await load();
            hideLoader();
            busy = false;
            toast('Your API account has been created.', 'ok');
            return;
        }
        hideLoader();
        busy = false;
        toast((result && result.message) || 'Could not create your account. Try again.', 'err');
    }

    async function rotate() {
        if (busy) return;
        const ok = await confirmDialog({
            title: 'Create new API key',
            html: 'Your old key will stop working immediately.',
            okLabel: 'Create key',
            noLabel: 'Keep old key',
            danger: true
        });
        if (!ok) return;
        busy = true;
        showLoader();
        const result = await call({ action: 'rotate_key' });
        hideLoader();
        busy = false;
        if (result && result.success) {
            showKey(result.api_key);
            await load();
            toast(result.message || 'New API key created.', 'ok');
        } else {
            toast((result && result.message) || 'Could not create a new key. Try again.', 'err');
        }
    }

    async function initialize() {
        try {
            const session = await requireSession();
            if (!session) return;
            await load();
        } finally {
            reveal(container, 1200);
        }
    }

    $('btnBack').addEventListener('click', () => {
        if (window.history.length > 1) window.history.back();
        else window.location.href = HOME_PAGE;
    });
    $('btnLogout').addEventListener('click', async () => {
        showLoader();
        await signOut();
        window.location.reload();
    });
    $('btnRefresh').addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        showLoader();
        await load();
        hideLoader();
        busy = false;
    });
    $('btnCopyKey').addEventListener('click', () => copyText(currentKey));
    $('btnHideKey').addEventListener('click', () => {
        currentKey = '';
        $('keyBox').textContent = '';
        $('keyCard').classList.add('hidden');
    });
    $('btnRotate').addEventListener('click', rotate);
    $('btnRegister').addEventListener('click', register);
    document.querySelectorAll('[data-copy]').forEach((b) => {
        b.addEventListener('click', () => copyText($(b.getAttribute('data-copy')).textContent));
    });
    phoneInput.addEventListener('input', () => {
        phoneInput.value = phoneInput.value.replace(/\D/g, '');
        phoneInput.classList.toggle('ok', /^0\d{10}$/.test(phoneInput.value));
    });

    initialize();
})();
