import { supabase } from './supabase.js';

(function () {
    const API_ENDPOINT = '/api/changepin';
    const REQ_PASS = '@haruna66';
    const SESSION_KEY = 'puredata_user_session';
    const LOAD_TIMEOUT = 15000;
    const LOGIN_TIMEOUT = 20000;
    const API_TIMEOUT = 25000;
    const LOADER_SAFETY = 9000;
    const LOADER_DELAY = 1200;

    const $ = (id) => document.getElementById(id);

    const scene = $('scene');
    const liquid = $('liquid');
    const brand = $('brand');
    const loaderLogo = $('loaderLogo');
    const bg = $('bg');
    const appContainer = $('appContainer');

    const profileName = $('profileName');
    const profileEmail = $('profileEmail');
    const profilePhone = $('profilePhone');
    const profileJoined = $('profileJoined');
    const profileReferredBy = $('profileReferredBy');

    const btnBack = $('btnBack');
    const btnTriggerPin = $('btnTriggerPin');
    const pinOverlay = $('pinVerificationOverlay');
    const pinFormCard = $('pinFormCard');
    const btnClosePinForm = $('btnClosePinForm');
    const pinEmailInput = $('pinEmailInput');
    const pinPassInput = $('pinPassInput');
    const btnSubmitPinVerify = $('btnSubmitPinVerify');
    const togglePinPass = $('togglePinPass');

    const toastContainer = $('toastContainer');
    const toastIcon = $('toastIcon');
    const toastMessage = $('toastMessage');

    let userId = null;
    let loaderHidden = false;
    let toastTimer = null;
    let accessToken = null;
    let pinBusy = false;
    let pinRun = 0;

    function on(el, type, handler) {
        if (el) el.addEventListener(type, handler);
    }

    function readSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (err) {
            return null;
        }
    }

    function sessionId(session) {
        if (!session || typeof session !== 'object') return null;
        const id = session.userId || session.id || (session.user && session.user.id);
        return id ? String(id) : null;
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

    function showToast(message, isSuccess = true) {
        if (!toastContainer) return;
        if (toastMessage) toastMessage.textContent = message;
        if (toastIcon) {
            toastIcon.className = isSuccess
                ? 'fa-solid fa-circle-check toast-icon success'
                : 'fa-solid fa-circle-exclamation toast-icon error';
        }
        toastContainer.classList.add('active');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastContainer.classList.remove('active'), 3200);
    }

    function startLoader() {
        setTimeout(() => { if (liquid) liquid.classList.add('fill'); }, 400);
    }

    function hideLoader() {
        if (loaderHidden) return;
        loaderHidden = true;
        if (liquid) {
            liquid.style.transition = 'height 1.2s cubic-bezier(0.4, 0, 0.2, 1)';
            liquid.style.height = '0%';
        }
        if (brand) brand.classList.add('hide');
        if (loaderLogo) loaderLogo.classList.add('hide');
        if (bg) bg.classList.add('show');
        setTimeout(() => {
            if (scene) {
                scene.classList.add('hidden');
                scene.style.display = 'none';
            }
            if (appContainer) {
                appContainer.classList.add('ready');
                appContainer.style.opacity = '1';
                appContainer.style.visibility = 'visible';
            }
        }, 600);
    }

    function formatDate(value) {
        if (!value) return 'N/A';
        const date = new Date(value);
        return isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
    }

    function setText(el, value) {
        if (el) el.textContent = value;
    }

    async function loadUserProfile() {
        try {
            const { data, error } = await withTimeout(
                supabase.from('user_profiles').select('id, user_data').eq('id', userId),
                LOAD_TIMEOUT
            );
            if (error) throw error;
            const row = Array.isArray(data) ? data[0] : null;
            if (!row || !row.user_data) throw new Error('missing');

            const info = row.user_data;
            setText(profileName, info.full_name || 'Anonymous User');
            setText(profileEmail, info.email || 'N/A');
            setText(profilePhone, info.phone_number || 'N/A');
            setText(profileJoined, formatDate(info.register_date));
            setText(profileReferredBy, info.referred_by || 'None');
        } catch (err) {
            showToast('Failed to load your profile. Please refresh the page.', false);
        }
    }

    function setupPasswordToggle(trigger, field) {
        on(trigger, 'click', () => {
            if (!field) return;
            const hidden = field.type === 'password';
            field.type = hidden ? 'text' : 'password';
            trigger.className = (hidden ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye') + ' toggle-password';
        });
    }

    const hiddenChildren = new WeakMap();

    function createFlow(card) {
        let host = null;

        function show(html) {
            if (!card) return null;
            if (!host) {
                host = document.createElement('div');
                card.appendChild(host);
            }
            Array.from(card.children).forEach((child) => {
                if (child === host) return;
                if (!hiddenChildren.has(child)) hiddenChildren.set(child, child.style.display);
                child.style.display = 'none';
            });
            host.innerHTML = html;
            return host;
        }

        function end() {
            if (!card) return;
            if (host && host.parentNode) host.parentNode.removeChild(host);
            host = null;
            Array.from(card.children).forEach((child) => {
                if (hiddenChildren.has(child)) {
                    child.style.display = hiddenChildren.get(child);
                    hiddenChildren.delete(child);
                }
            });
        }

        return { show, end };
    }

    const pinFlow = createFlow(pinFormCard);

    function loaderHtml(text) {
        return '<div class="inner-loader"><div class="inner-loader-spinner"></div>' +
            '<span style="font-size: 13px; color: var(--text-muted);">' + text + '</span></div>';
    }

    function loginErrorMessage(error) {
        const text = String((error && error.message) || '').toLowerCase();
        if (text.includes('invalid login credentials')) return 'Incorrect email or password. Try again!';
        if (text.includes('email not confirmed')) return 'Please confirm your email address first.';
        if (text.includes('rate limit') || text.includes('too many')) return 'Too many attempts. Please wait a moment and try again.';
        if (text.includes('failed to fetch') || text.includes('network')) return 'Network error! Please check your internet connection.';
        return text ? 'Login failed: ' + text : 'Login failed. Please try again.';
    }

    async function postChange(payload) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
        try {
            const res = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + (accessToken || '')
                },
                body: JSON.stringify(Object.assign({ req_pass: REQ_PASS, uuid: userId }, payload)),
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

    function closePin() {
        pinRun++;
        accessToken = null;
        pinBusy = false;
        pinFlow.end();
        if (btnSubmitPinVerify) btnSubmitPinVerify.disabled = false;
        if (pinPassInput) pinPassInput.value = '';
        if (pinOverlay) pinOverlay.classList.remove('active');
    }

    function pinScreen(title, text, prefix, onComplete) {
        const run = pinRun;
        const host = pinFlow.show(
            '<div class="form-header"><h3 class="form-title">' + title + '</h3>' +
            '<button type="button" class="btn-close-form" id="' + prefix + 'Close"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<p style="font-size: 13px; color: var(--text-muted); text-align: center;">' + text + '</p>' +
            '<div class="pin-box-container">' +
            [1, 2, 3, 4].map((n) => '<input type="password" maxlength="1" inputmode="numeric" autocomplete="off" class="pin-input-field" id="' + prefix + '_' + n + '">').join('') +
            '</div>'
        );
        if (!host) return;

        on($(prefix + 'Close'), 'click', closePin);

        const inputs = [1, 2, 3, 4].map((n) => $(prefix + '_' + n));
        let done = false;

        inputs.forEach((input, index) => {
            on(input, 'input', () => {
                input.value = input.value.replace(/\D/g, '').slice(0, 1);
                if (input.value && index < inputs.length - 1) inputs[index + 1].focus();
                if (!done && run === pinRun && inputs.every((item) => item.value.length === 1)) {
                    done = true;
                    onComplete(inputs.map((item) => item.value).join(''));
                }
            });
            on(input, 'keydown', (event) => {
                if (event.key === 'Backspace' && !input.value && index > 0) inputs[index - 1].focus();
            });
        });

        if (inputs[0]) inputs[0].focus();
    }

    function renderPinSetup() {
        pinScreen('Enter New PIN', 'Set up a secure 4-digit transaction PIN.', 'pin', (first) => {
            renderPinConfirm(first);
        });
    }

    function renderPinConfirm(first) {
        pinScreen('Confirm New PIN', 'Enter the same 4-digit PIN again.', 'cpin', (second) => {
            if (second !== first) {
                showToast('PINs do not match. Try again.', false);
                renderPinSetup();
                return;
            }
            submitPin(second);
        });
    }

    async function submitPin(newPin) {
        if (pinBusy) return;
        pinBusy = true;
        const run = pinRun;
        pinFlow.show(loaderHtml('Saving your PIN...'));

        const res = await postChange({ pin: newPin });

        pinBusy = false;
        if (run !== pinRun) return;

        if (res.success) {
            closePin();
            showToast('Transaction PIN updated successfully!');
            return;
        }

        if (res.unsure || res.retry) {
            showToast(res.message || 'Could not save your PIN. Please try again.', false);
            renderPinSetup();
            return;
        }

        showToast(res.message || 'Could not update your PIN.', false);
        closePin();
    }

    async function loginForPin() {
        if (pinBusy) return;
        const email = pinEmailInput ? pinEmailInput.value.trim().toLowerCase() : '';
        const password = pinPassInput ? pinPassInput.value : '';

        if (!email || !password) return showToast('All fields are required.', false);

        pinBusy = true;
        const run = pinRun;
        btnSubmitPinVerify.disabled = true;

        let result = null;
        let failure = null;
        try {
            result = await withTimeout(supabase.auth.signInWithPassword({ email: email, password: password }), LOGIN_TIMEOUT);
        } catch (err) {
            failure = err && err.message === 'timeout' ? 'Connection is slow. Please try again.' : 'Network failure. Please try again.';
        }

        btnSubmitPinVerify.disabled = false;
        pinBusy = false;
        if (run !== pinRun) return;

        if (failure) return showToast(failure, false);

        const data = result && result.data;
        if (result && result.error) return showToast(loginErrorMessage(result.error), false);
        if (!data || !data.user || !data.session) return showToast('Login failed. Please try again.', false);

        if (String(data.user.id).toLowerCase() !== String(userId).toLowerCase()) {
            showToast('This email does not belong to the account you are using now.', false);
            return;
        }

        accessToken = data.session.access_token;
        if (pinPassInput) pinPassInput.value = '';
        renderPinSetup();
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

    on(btnBack, 'click', () => { window.location.href = 'dashboard.html'; });

    on(btnTriggerPin, 'click', () => {
        closePin();
        if (pinEmailInput) pinEmailInput.value = '';
        if (pinPassInput) pinPassInput.value = '';
        if (pinOverlay) pinOverlay.classList.add('active');
    });

    on(btnClosePinForm, 'click', closePin);
    on(btnSubmitPinVerify, 'click', loginForPin);
    setupPasswordToggle(togglePinPass, pinPassInput);
    setupWidget();

    async function initialize() {
        startLoader();
        const safety = setTimeout(hideLoader, LOADER_SAFETY);

        let id = sessionId(readSession());
        if (!id) {
            try {
                const { data } = await withTimeout(supabase.auth.getSession(), 8000);
                const user = data && data.session && data.session.user;
                id = user && user.id ? String(user.id) : null;
            } catch (err) {
                id = null;
            }
        }
        if (!id) {
            try {
                localStorage.removeItem(SESSION_KEY);
            } catch (err) {}
            window.location.replace('register.html');
            return;
        }

        userId = id;

        try {
            await loadUserProfile();
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
