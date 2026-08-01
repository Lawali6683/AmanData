import { supabase } from './supabase.js';

(function() {
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

    try {
        if ('caches' in window) {
            caches.keys().then(names => {
                for (let name of names) caches.delete(name);
            });
        }
        if (window.registration && window.registration.unregister) {
            window.registration.unregister();
        }
    } catch (e) {}

    tabLoginBtn.addEventListener('click', () => {
        tabLoginBtn.classList.add('active');
        tabRegisterBtn.classList.remove('active');
        formLogin.classList.add('active');
        formRegister.classList.remove('active');
        pageTitle.textContent = "Welcome Back!";
        pageSubtitle.textContent = "Login to your account";
    });

    tabRegisterBtn.addEventListener('click', () => {
        tabRegisterBtn.classList.add('active');
        tabLoginBtn.classList.remove('active');
        formRegister.classList.add('active');
        formLogin.classList.remove('active');
        pageTitle.textContent = "Create Account";
        pageSubtitle.textContent = "Sign up and get started";
    });

    document.querySelectorAll('.toggle-password').forEach(icon => {
        icon.addEventListener('click', function() {
            const targetId = this.getAttribute('data-target');
            const inputField = document.getElementById(targetId);
            if (inputField.type === 'password') {
                inputField.type = 'text';
                this.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                inputField.type = 'password';
                this.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });
    });

    const pinBoxes = document.querySelectorAll('.pin-box');
    pinBoxes.forEach((box, idx) => {
        box.addEventListener('input', (e) => {
            box.value = box.value.replace(/\D/g, '');
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

    function showToast(msg, isSuccess = false) {
        toastMessage.textContent = msg;
        const icon = toastContainer.querySelector('.id-toast-icon');
        if (isSuccess) {
            icon.className = "fa-solid fa-circle-check id-toast-icon toast-icon success";
        } else {
            icon.className = "fa-solid fa-circle-exclamation id-toast-icon toast-icon error";
        }
        toastContainer.classList.add('active');
        setTimeout(() => {
            toastContainer.classList.remove('active');
        }, 5000);
    }

    function toggleLoader(show) {
        if (show) {
            loaderOverlay.classList.add('active');
            setTimeout(() => { liquidFill.style.height = '100%'; }, 50);
        } else {
            liquidFill.style.height = '0%';
            setTimeout(() => { loaderOverlay.classList.remove('active'); }, 600);
        }
    }

    function processReferralExtraction() {
        const urlParams = new URLSearchParams(window.location.search);
        let discoveredCode = '';
        if (window.location.pathname.includes('/ref/')) {
            const pathParts = window.location.pathname.split('/ref/');
            if (pathParts[1]) discoveredCode = pathParts[1].replace('/', '').trim();
        } else if (urlParams.has('ref')) {
            discoveredCode = urlParams.get('ref').trim();
        }
        if (discoveredCode && discoveredCode.length === 6) {
            refInput.value = discoveredCode;
            refInput.readOnly = true;
            return;
        }
        navigator.clipboard.readText().then(text => {
            const cleanText = text.trim();
            if (/^[A-Z0-9]{6}$/i.test(cleanText)) {
                refInput.value = cleanText;
            }
        }).catch(() => {});
    }

    window.addEventListener('DOMContentLoaded', processReferralExtraction);

    async function fetchNetworkMetadata() {
        let ip = "0.0.0.0", loc = "Unknown Location", devInfo = navigator.userAgent;
        try {
            const res = await fetch('https://ipapi.co/json/');
            if (res.ok) {
                const data = await res.json();
                ip = data.ip || ip;
                loc = `${data.city || ''}, ${data.region || ''}, ${data.country_name || ''}`.trim();
            }
        } catch(e){}
        return { ip, loc, devInfo };
    }

    document.getElementById('executeLoginBtn').addEventListener('click', async () => {
        const email = document.getElementById('loginEmail').value.trim();
        const pass = document.getElementById('loginPassword').value;

        if (!email || !pass) {
            showToast("Please fill in all login credentials!");
            return;
        }

        toggleLoader(true);
        try {
            const { data: matchedRecords, error } = await supabase
                .from('user_profiles')
                .select('*');

            if (error) throw error;

            const activeProfile = matchedRecords.find(profile => profile.user_data && profile.user_data.email.toLowerCase() === email.toLowerCase());
            
            if (!activeProfile) {
                toggleLoader(false);
                showToast("No account linked with this email address!");
                return;
            }

            if (activeProfile.user_data.password !== pass) {
                toggleLoader(false);
                showToast("Incorrect account password. Please try again!");
                return;
            }

            showToast("Login successful! Redirecting...", true);
            setTimeout(() => { window.location.replace('dashboard.html'); }, 1500);

        } catch (err) {
            toggleLoader(false);
            showToast("Network failure or database verification error!");
        }
    });

    document.getElementById('executeRegisterBtn').addEventListener('click', async () => {
        const fullName = document.getElementById('regName').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const phone = document.getElementById('regPhone').value.trim();
        const refCodeField = refInput.value.trim();
        const pass = document.getElementById('regPassword').value;
        const confirmPass = document.getElementById('regConfirmPassword').value;
        const acceptTerms = document.getElementById('regTerms').checked;

        let gatheredPin = "";
        pinBoxes.forEach(b => gatheredPin += b.value);

        if (!fullName || !email || !phone || gatheredPin.length !== 4 || !pass || !confirmPass) {
            showToast("Please complete all registration form fields!");
            return;
        }

        if (pass !== confirmPass) {
            showToast("Password confirmation mismatch! Verify entries.");
            return;
        }

        if (!acceptTerms) {
            showToast("You must accept terms & conditions to continue.");
            return;
        }

        toggleLoader(true);
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

        try {
            const apiResponse = await fetch('https://www.amandata.com.ng/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const backendStatus = await apiResponse.json();

            if (!apiResponse.ok || !backendStatus.success) {
                throw new Error(backendStatus.message || "Registration gateway rejected your submission.");
            }

            showToast("Account created successfully! Preparing dashboard...", true);
            setTimeout(() => { window.location.replace('dashboard.html'); }, 1500);

        } catch (error) {
            toggleLoader(false);
            showToast(error.message || "Network connection failure (Failed to fetch API).");
        }
    });
})();
