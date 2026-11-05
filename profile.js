import { supabase } from './supabase.js';

(function () {
    const API_ENDPOINT = '/api/pin';
    const REQ_PASS = '@haruna66';
    const SESSION_KEY = 'puredata_user_session';
    const LOAD_TIMEOUT = 15000;
    const API_TIMEOUT = 25000;
    const LOADER_SAFETY = 9000;
    const LOADER_DELAY = 1200;
    const MIN_PASSWORD = 6;

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

    const btnTriggerPin = $('btnTriggerPin');
    const btnTriggerPassword = $('btnTriggerPassword');

    const pinOverlay = $('pinVerificationOverlay');
    const pinFormCard = $('pinFormCard');
    const btnClosePinForm = $('btnClosePinForm');
    const pinEmailInput = $('pinEmailInput');
    const pinPassInput = $('pinPassInput');
    const btnSubmitPinVerify = $('btnSubmitPinVerify');
    const togglePinPass = $('togglePinPass');

    const passOverlay = $('passwordVerificationOverlay');
    const passFormCard = $('passwordFormCard');
    const btnClosePassForm = $('btnClosePassForm');
    const passEmailInput = $('passEmailInput');
    const passOldInput = $('passOldInput');
    const btnSubmitPassVerify = $('btnSubmitPassVerify');
    const togglePassOld = $('togglePassOld');

    const passwordStep1Fields = $('passwordStep1Fields');
    const passwordStep2Fields = $('passwordStep2Fields');
    const passNewInput = $('passNewInput');
    const passConfirmInput = $('passConfirmInput');
    const btnSubmitPassChange = $('btnSubmitPassChange');
    const togglePassNew = $('togglePassNew');
    const togglePassConfirm = $('togglePassConfirm');

    const toastContainer = $('toastContainer');
    const toastIcon = $('toastIcon');
    const toastMessage = $('toastMessage');

    let userId = null;
    let profile = null;
    let loaderHidden = false;
    let toastTimer = null;
    let pinCreds = null;
    let passCreds = null;
    let pinBusy = false;
    let passBusy = false;
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

            profile = row;
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
    const passFlow = createFlow(passFormCard);

    function loaderHtml(text) {
        return '<div class="inner-loader"><div class="inner-loader-spinner"></div>' +
            '<span style="font-size: 13px; color: var(--text-muted);">' + text + '</span></div>';
    }

    async function postPin(payload) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
        try {
            const res = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ password: REQ_PASS, uuid: userId }, payload)),
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
        pinCreds = null;
        pinBusy = false;
        pinFlow.end();
        if (pinPassInput) pinPassInput.value = '';
        if (pinOverlay) pinOverlay.classList.remove('active');
    }

    function closePass() {
        passCreds = null;
        passBusy = false;
        passFlow.end();
        showPassStep(1);
        if (passOldInput) passOldInput.value = '';
        if (passNewInput) passNewInput.value = '';
        if (passConfirmInput) passConfirmInput.value = '';
        if (passOverlay) passOverlay.classList.remove('active');
    }

    function showPassStep(step) {
        if (passwordStep1Fields) passwordStep1Fields.style.display = step === 1 ? 'flex' : 'none';
        if (passwordStep2Fields) passwordStep2Fields.style.display = step === 2 ? 'flex' : 'none';
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
        pinScreen('Enter New PIN', 'Set up a secure 4-digit transaction authority code.', 'pin', (first) => {
            pinFlow.show(loaderHtml('Verifying configuration...'));
            const run = pinRun;
            setTimeout(() => {
                if (run !== pinRun) return;
                renderPinConfirm(first);
            }, 600);
        });
    }

    function renderPinConfirm(first) {
        pinScreen('Confirm New PIN', 'Confirm your 4-digit transaction authority code.', 'cpin', (second) => {
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

        const res = await postPin({
            type: 'pin',
            email: pinCreds ? pinCreds.email : '',
            current_password: pinCreds ? pinCreds.password : '',
            pin: newPin
        });

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

    async function verifyCredentials(email, password) {
        return postPin({ type: 'verify', email: email, current_password: password });
    }

    on(btnTriggerPin, 'click', () => {
        closePin();
        if (pinEmailInput) pinEmailInput.value = '';
        if (pinPassInput) pinPassInput.value = '';
        if (pinOverlay) pinOverlay.classList.add('active');
    });

    on(btnClosePinForm, 'click', closePin);

    on(btnSubmitPinVerify, 'click', async () => {
        if (pinBusy) return;
        const email = pinEmailInput ? pinEmailInput.value.trim() : '';
        const password = pinPassInput ? pinPassInput.value : '';

        if (!email || !password) return showToast('All fields are required.', false);

        pinBusy = true;
        const run = pinRun;
        btnSubmitPinVerify.disabled = true;
        const res = await verifyCredentials(email, password);
        btnSubmitPinVerify.disabled = false;
        pinBusy = false;
        if (run !== pinRun) return;

        if (!res.success) return showToast(res.message || 'Invalid security credentials.', false);

        pinCreds = { email: email, password: password };
        renderPinSetup();
    });

    on(btnTriggerPassword, 'click', () => {
        closePass();
        if (passEmailInput) passEmailInput.value = '';
        showPassStep(1);
        if (passOverlay) passOverlay.classList.add('active');
    });

    on(btnClosePassForm, 'click', closePass);

    on(btnSubmitPassVerify, 'click', async () => {
        if (passBusy) return;
        const email = passEmailInput ? passEmailInput.value.trim() : '';
        const current = passOldInput ? passOldInput.value : '';

        if (!email || !current) return showToast('All credentials must be filled.', false);

        passBusy = true;
        btnSubmitPassVerify.disabled = true;
        const res = await verifyCredentials(email, current);
        btnSubmitPassVerify.disabled = false;
        passBusy = false;

        if (!res.success) return showToast(res.message || 'Invalid credentials.', false);

        passCreds = { email: email, password: current };
        showPassStep(2);
    });

    on(btnSubmitPassChange, 'click', async () => {
        if (passBusy || !passCreds) return;
        const next = passNewInput ? passNewInput.value : '';
        const confirm = passConfirmInput ? passConfirmInput.value : '';

        if (!next || !confirm) return showToast('Please fill all password fields.', false);
        if (next.length < MIN_PASSWORD) return showToast('Password must be at least ' + MIN_PASSWORD + ' characters.', false);
        if (next !== confirm) return showToast('Passwords do not match.', false);
        if (next === passCreds.password) return showToast('New password must be different from the current one.', false);

        passBusy = true;
        passFlow.show(loaderHtml('Updating your password...'));

        const res = await postPin({
            type: 'password',
            email: passCreds.email,
            current_password: passCreds.password,
            new_password: next
        });

        passBusy = false;
        passFlow.end();

        if (res.success) {
            closePass();
            showToast('Password changed successfully!');
            return;
        }

        showToast(res.message || 'Failed to change your password.', false);
        if (!(res.unsure || res.retry)) closePass();
    });

    setupPasswordToggle(togglePinPass, pinPassInput);
    setupPasswordToggle(togglePassOld, passOldInput);
    setupPasswordToggle(togglePassNew, passNewInput);
    setupPasswordToggle(togglePassConfirm, passConfirmInput);

    async function initialize() {
        startLoader();
        const safety = setTimeout(hideLoader, LOADER_SAFETY);

        const id = sessionId(readSession());
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
