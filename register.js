import { supabase } from './supabase.js';

(function () {

    const SESSION_KEY = 'puredata_user_session';
    const DASHBOARD_URL = 'dashboard0.html';
    const REQUEST_TIMEOUT = 20000;
    const LOADER_WATCHDOG = 40000;

    const tabLoginBtn = document.getElementById('tabLoginBtn');
    const tabRegisterBtn = document.getElementById('tabRegisterBtn');
    const formLogin = document.getElementById('formLogin');
    const formRegister = document.getElementById('formRegister');
    const pageTitle = document.getElementById('pageTitle');
    const pageSubtitle = document.getElementById('pageSubtitle');
    const loaderOverlay = document.getElementById('loaderOverlay');
    const liquidFill = document.getElementById('liquidFill');
    const toastContainer = document.getElementById('toastContainer');
    const toastMessage = document.getElementById('toastMessage');
    const refInput = document.getElementById('regRef');
    const loginBtn = document.getElementById('executeLoginBtn');
    const registerBtn = document.getElementById('executeRegisterBtn');

    let isBusy = false;
    let loaderWatchdogTimer = null;
    let toastTimer = null;

    function saveSession(sessionObject) {
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(sessionObject));
            return !!localStorage.getItem(SESSION_KEY);
        } catch (e) {
            return false;
        }
    }

    function goToDashboard() {
        try {
            window.location.replace(DASHBOARD_URL);
        } catch (e) {
            window.location.href = DASHBOARD_URL;
        }
        setTimeout(() => { window.location.href = DASHBOARD_URL; }, 2500);
    }

    async function checkExistingSession() {
        try {
            const { data } = await supabase.auth.getSession();
            const session = data && data.session ? data.session : null;
            if (session && session.user && session.user.id) {
                saveSession({
                    id: session.user.id,
                    userId: session.user.id,
                    name: (session.user.user_metadata && session.user.user_metadata.full_name) || '',
                    email: session.user.email || ''
                });
                goToDashboard();
                return;
            }
        } catch (e) {}

        try {
            if (localStorage.getItem(SESSION_KEY)) {
                localStorage.removeItem(SESSION_KEY);
            }
        } catch (e) {}
    }

    checkExistingSession();

    function showToast(msg, isSuccess = false) {
        if (!toastContainer || !toastMessage) return;
        toastMessage.textContent = msg;
        const icon = toastContainer.querySelector('.id-toast-icon');
        if (icon) {
            icon.className = isSuccess
                ? "fa-solid fa-circle-check id-toast-icon toast-icon success"
                : "fa-solid fa-circle-exclamation id-toast-icon toast-icon error";
        }
        toastContainer.classList.add('active');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastContainer.classList.remove('active'); }, 4000);
    }

    function setButtonsDisabled(disabled) {
        if (loginBtn) loginBtn.disabled = disabled;
        if (registerBtn) registerBtn.disabled = disabled;
    }

    function toggleLoader(show) {
        if (!loaderOverlay || !liquidFill) return;

        if (loaderWatchdogTimer) {
            clearTimeout(loaderWatchdogTimer);
            loaderWatchdogTimer = null;
        }

        if (show) {
            loaderOverlay.classList.add('active');
            setTimeout(() => { liquidFill.style.height = '100%'; }, 50);
            loaderWatchdogTimer = setTimeout(() => {
                toggleLoader(false);
                isBusy = false;
                setButtonsDisabled(false);
                showToast("Request took too long. Please try again.");
            }, LOADER_WATCHDOG);
        } else {
            liquidFill.style.height = '0%';
            setTimeout(() => { loaderOverlay.classList.remove('active'); }, 600);
        }
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

    function finishWithSuccess(sessionObject, message) {
        if (!saveSession(sessionObject)) {
            toggleLoader(false);
            isBusy = false;
            setButtonsDisabled(false);
            showToast("Your browser is blocking storage. Please disable private mode and try again.");
            return;
        }

        toggleLoader(false);
        showToast(message, true);
        setTimeout(goToDashboard, 1200);
    }

    function openLoginTab() {
        if (tabLoginBtn) tabLoginBtn.click();
    }

    if (tabLoginBtn && tabRegisterBtn && formLogin && formRegister) {
        tabLoginBtn.addEventListener('click', () => {
            tabLoginBtn.classList.add('active');
            tabRegisterBtn.classList.remove('active');
            formLogin.classList.add('active');
            formRegister.classList.remove('active');
            if (pageTitle) pageTitle.textContent = "Welcome Back!";
            if (pageSubtitle) pageSubtitle.textContent = "Login to your account";
        });

        tabRegisterBtn.addEventListener('click', () => {
            tabRegisterBtn.classList.add('active');
            tabLoginBtn.classList.remove('active');
            formRegister.classList.add('active');
            formLogin.classList.remove('active');
            if (pageTitle) pageTitle.textContent = "Create Account";
            if (pageSubtitle) pageSubtitle.textContent = "Sign up and get started";
        });
    }

    document.querySelectorAll('.toggle-password').forEach((icon) => {
        icon.addEventListener('click', function () {
            const inputField = document.getElementById(this.getAttribute('data-target'));
            if (!inputField) return;
            if (inputField.type === 'password') {
                inputField.type = 'text';
                this.classList.remove('fa-eye');
                this.classList.add('fa-eye-slash');
            } else {
                inputField.type = 'password';
                this.classList.remove('fa-eye-slash');
                this.classList.add('fa-eye');
            }
        });
    });

    const pinBoxes = document.querySelectorAll('.pin-box');
    pinBoxes.forEach((box, idx) => {
        box.addEventListener('input', () => {
            box.value = box.value.replace(/\D/g, '').slice(0, 1);
            if (box.value.length === 1 && idx < pinBoxes.length - 1) {
                pinBoxes[idx + 1].focus();
            }
        });
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && box.value.length === 0 && idx > 0) {
                pinBoxes[idx - 1].focus();
            }
        });
    });

    function processReferralExtraction() {
        if (!refInput) return;

        try {
            const urlParams = new URLSearchParams(window.location.search);
            let discoveredCode = '';

            if (window.location.pathname.includes('/ref/')) {
                const pathParts = window.location.pathname.split('/ref/');
                if (pathParts[1]) discoveredCode = pathParts[1].replace('/', '').trim();
            } else if (urlParams.has('ref')) {
                discoveredCode = (urlParams.get('ref') || '').trim();
            }

            if (discoveredCode && discoveredCode.length === 6) {
                refInput.value = discoveredCode;
                refInput.readOnly = true;
                return;
            }

            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then((text) => {
                    const cleanText = (text || '').trim();
                    if (/^[A-Z0-9]{6}$/i.test(cleanText)) {
                        refInput.value = cleanText;
                    }
                }).catch(() => {});
            }
        } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', processReferralExtraction);
    } else {
        processReferralExtraction();
    }

    async function fetchNetworkMetadata() {
        let ip = "0.0.0.0";
        let loc = "Unknown Location";
        const devInfo = navigator.userAgent;

        try {
            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const abortTimer = setTimeout(() => { if (controller) controller.abort(); }, 4000);
            const res = await withTimeout(
                fetch('https://ipapi.co/json/', controller ? { signal: controller.signal } : {}),
                4500
            );
            clearTimeout(abortTimer);

            if (res && res.ok) {
                const data = await res.json();
                ip = data.ip || ip;
                loc = `${data.city || ''}, ${data.region || ''}, ${data.country_name || ''}`.trim();
            }
        } catch (e) {}

        return { ip, loc, devInfo };
    }

    function loginErrorMessage(error) {
        const text = String((error && error.message) || '').toLowerCase();
        if (text.includes('invalid login credentials')) {
            return "Incorrect email or password. Try again!";
        }
        if (text.includes('email not confirmed')) {
            return "Please confirm your email address first.";
        }
        if (text.includes('rate limit') || text.includes('too many')) {
            return "Too many attempts. Please wait a moment and try again.";
        }
        if (text.includes('failed to fetch') || text.includes('network')) {
            return "Network error! Please check your internet connection.";
        }
        return "Login failed. Please try again.";
    }

    async function handleLogin() {
        if (isBusy) return;

        const email = document.getElementById('loginEmail').value.trim().toLowerCase();
        const pass = document.getElementById('loginPassword').value;

        if (!email || !pass) {
            showToast("Please fill in all login credentials!");
            return;
        }

        isBusy = true;
        setButtonsDisabled(true);
        toggleLoader(true);

        try {
            const { data, error } = await withTimeout(
                supabase.auth.signInWithPassword({ email: email, password: pass }),
                REQUEST_TIMEOUT
            );

            if (error || !data || !data.user) {
                toggleLoader(false);
                showToast(loginErrorMessage(error));
                return;
            }

            const user = data.user;

            finishWithSuccess({
                id: user.id,
                userId: user.id,
                name: (user.user_metadata && user.user_metadata.full_name) || '',
                email: user.email || email
            }, "Login successful! Redirecting...");

        } catch (err) {
            toggleLoader(false);
            if (err && err.message === 'timeout') {
                showToast("Connection is slow. Please try again.");
            } else {
                showToast("Network failure or server security block!");
            }
        } finally {
            isBusy = false;
            setButtonsDisabled(false);
        }
    }

    async function handleRegister() {
        if (isBusy) return;

        const fullName = document.getElementById('regName').value.trim();
        const email = document.getElementById('regEmail').value.trim().toLowerCase();
        const phone = document.getElementById('regPhone').value.trim();
        const refCodeField = refInput ? refInput.value.trim() : '';
        const pass = document.getElementById('regPassword').value;
        const confirmPass = document.getElementById('regConfirmPassword').value;
        const acceptTerms = document.getElementById('regTerms').checked;

        let gatheredPin = "";
        pinBoxes.forEach((b) => { gatheredPin += b.value; });

        if (!fullName || !email || !phone || gatheredPin.length !== 4 || !pass || !confirmPass) {
            showToast("Please complete all registration form blocks!");
            return;
        }

        if (pass.length < 6) {
            showToast("Password must be at least 6 characters.");
            return;
        }

        if (pass !== confirmPass) {
            showToast("Password confirmation mismatch!");
            return;
        }

        if (!acceptTerms) {
            showToast("You must accept terms & conditions to continue.");
            return;
        }

        isBusy = true;
        setButtonsDisabled(true);
        toggleLoader(true);

        try {
            const netMetaData = await fetchNetworkMetadata();

            const payload = {
                fullName: fullName,
                email: email,
                phone: phone,
                pin: gatheredPin,
                password: pass,
                referralBy: refCodeField || null,
                ipAddress: netMetaData.ip,
                location: netMetaData.loc,
                device: netMetaData.devInfo,
                secureToken: "@haruna66"
            };

            const apiResponse = await withTimeout(fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            }), 30000);

            if (!apiResponse.ok) {
                const errorData = await apiResponse.json().catch(() => ({}));
                throw new Error(errorData.message || `Server Error (${apiResponse.status})`);
            }

            const backendStatus = await apiResponse.json();

            if (!backendStatus || !backendStatus.success) {
                throw new Error((backendStatus && backendStatus.message) || "Registration operation rejected.");
            }

            let signedUser = null;

            try {
                const { data, error } = await withTimeout(
                    supabase.auth.signInWithPassword({ email: email, password: pass }),
                    REQUEST_TIMEOUT
                );
                if (!error && data && data.user) signedUser = data.user;
            } catch (e) {}

            if (!signedUser) {
                toggleLoader(false);
                showToast("Account created. Please login to continue.", true);
                openLoginTab();
                const loginEmailField = document.getElementById('loginEmail');
                if (loginEmailField) loginEmailField.value = email;
                return;
            }

            finishWithSuccess({
                id: signedUser.id,
                userId: signedUser.id,
                name: fullName,
                email: email
            }, "Account created successfully!");

        } catch (error) {
            toggleLoader(false);
            if (error && error.message === 'timeout') {
                showToast("Connection is slow. Please try again.");
            } else if (error && error.name === 'TypeError') {
                showToast("Network error! Please check your internet connection.");
            } else {
                showToast((error && error.message) || "Server error during registration.");
            }
        } finally {
            isBusy = false;
            setButtonsDisabled(false);
        }
    }

    if (formLogin) {
        formLogin.addEventListener('submit', (e) => {
            e.preventDefault();
            handleLogin();
        });
    }

    if (formRegister) {
        formRegister.addEventListener('submit', (e) => {
            e.preventDefault();
            handleRegister();
        });
    }

    window.addEventListener('unhandledrejection', () => {
        if (isBusy) {
            toggleLoader(false);
            isBusy = false;
            setButtonsDisabled(false);
            showToast("Something went wrong. Please try again.");
        }
    });

})();
