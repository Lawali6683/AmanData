import { supabase } from './supabase.js';

(function() {
    const scene = document.getElementById('scene');
    const liquid = document.getElementById('liquid');
    const brand = document.getElementById('brand');
    const loaderLogo = document.getElementById('loaderLogo');
    const bg = document.getElementById('bg');
    const appContainer = document.getElementById('appContainer');

    const profileInitials = document.getElementById('profileInitials');
    const profileName = document.getElementById('profileName');
    const profileLocation = document.getElementById('profileLocation');
    const profileEmail = document.getElementById('profileEmail');
    const profilePhone = document.getElementById('profilePhone');
    const profileJoined = document.getElementById('profileJoined');
    const profileReferredBy = document.getElementById('profileReferredBy');

    const btnTriggerPin = document.getElementById('btnTriggerPin');
    const btnTriggerPassword = document.getElementById('btnTriggerPassword');

    const pinOverlay = document.getElementById('pinVerificationOverlay');
    const pinFormCard = document.getElementById('pinFormCard');
    const btnClosePinForm = document.getElementById('btnClosePinForm');
    const pinEmailInput = document.getElementById('pinEmailInput');
    const pinPassInput = document.getElementById('pinPassInput');
    const btnSubmitPinVerify = document.getElementById('btnSubmitPinVerify');
    const togglePinPass = document.getElementById('togglePinPass');

    const passOverlay = document.getElementById('passwordVerificationOverlay');
    const passFormCard = document.getElementById('passwordFormCard');
    const btnClosePassForm = document.getElementById('btnClosePassForm');
    const passEmailInput = document.getElementById('passEmailInput');
    const passOldInput = document.getElementById('passOldInput');
    const btnSubmitPassVerify = document.getElementById('btnSubmitPassVerify');
    const togglePassOld = document.getElementById('togglePassOld');

    const passwordStep1Fields = document.getElementById('passwordStep1Fields');
    const passwordStep2Fields = document.getElementById('passwordStep2Fields');
    const passNewInput = document.getElementById('passNewInput');
    const passConfirmInput = document.getElementById('passConfirmInput');
    const btnSubmitPassChange = document.getElementById('btnSubmitPassChange');
    const togglePassNew = document.getElementById('togglePassNew');
    const togglePassConfirm = document.getElementById('togglePassConfirm');

    const toastContainer = document.getElementById('toastContainer');
    const toastIcon = document.getElementById('toastIcon');
    const toastMessage = document.getElementById('toastMessage');

    const sessionTokenString = localStorage.getItem('puredata_user_session');
    let cachedProfile = null;

    setTimeout(() => {
        liquid.classList.add('fill');
    }, 400);

    function showToast(message, isSuccess = true) {
        toastMessage.textContent = message;
        if (isSuccess) {
            toastIcon.className = "fa-solid fa-circle-check toast-icon success";
        } else {
            toastIcon.className = "fa-solid fa-circle-exclamation toast-icon error";
        }
        toastContainer.classList.add('active');
        setTimeout(() => {
            toastContainer.classList.remove('active');
        }, 3000);
    }

    function hideLoader() {
        liquid.style.transition = 'height 1.8s cubic-bezier(0.4, 0, 0.2, 1)';
        liquid.style.height = '0%';
        brand.classList.add('hide');
        loaderLogo.classList.add('hide');
        bg.classList.add('show');
        setTimeout(() => {
            scene.classList.add('hidden');
            appContainer.classList.add('ready');
        }, 600);
    }

    async function loadUserProfile() {
        if (!sessionTokenString) {
            window.location.replace('register.html');
            return;
        }

        const activeSession = JSON.parse(sessionTokenString);
        const userUUID = activeSession.id;

        try {
            const { data, error } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('id', userUUID)
                .single();

            if (error) throw error;

            cachedProfile = data;
            const profileData = data.user_data;

            const fullName = profileData.full_name || "Anonymous User";
            profileName.textContent = fullName;
            profileEmail.textContent = profileData.email || "N/A";
            profilePhone.textContent = profileData.phone_number || "N/A";
            profileLocation.textContent = profileData.location || "Nigeria";
            profileJoined.textContent = profileData.register_date ? new Date(profileData.register_date).toLocaleDateString() : "N/A";
            profileReferredBy.textContent = profileData.referred_by || "None";

            const initials = fullName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            profileInitials.textContent = initials;

        } catch (err) {
            showToast("Failed to fetch profile. Loaded offline state.", false);
        } finally {
            setTimeout(hideLoader, 2200);
        }
    }

    function setupPasswordToggle(trigger, field) {
        trigger.addEventListener('click', () => {
            if (field.type === "password") {
                field.type = "text";
                trigger.className = "fa-regular fa-eye-slash toggle-password";
            } else {
                field.type = "password";
                trigger.className = "fa-regular fa-eye toggle-password";
            }
        });
    }

    setupPasswordToggle(togglePinPass, pinPassInput);
    setupPasswordToggle(togglePassOld, passOldInput);
    setupPasswordToggle(togglePassNew, passNewInput);
    setupPasswordToggle(togglePassConfirm, passConfirmInput);

    btnTriggerPin.addEventListener('click', () => {
        pinEmailInput.value = "";
        pinPassInput.value = "";
        pinOverlay.classList.add('active');
    });

    btnClosePinForm.addEventListener('click', () => {
        pinOverlay.classList.remove('active');
    });

    btnTriggerPassword.addEventListener('click', () => {
        passEmailInput.value = "";
        passOldInput.value = "";
        passNewInput.value = "";
        passConfirmInput.value = "";
        passwordStep1Fields.style.display = "flex";
        passwordStep2Fields.style.display = "none";
        passOverlay.classList.add('active');
    });

    btnClosePassForm.addEventListener('click', () => {
        passOverlay.classList.remove('active');
    });

    async function triggerEmailNotification(fullName, email, actionType) {
        try {
            fetch('https://amandata.pages.dev/api/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    full_name: fullName,
                    email: email,
                    action: actionType
                })
            });
        } catch (e) {}
    }

    btnSubmitPinVerify.addEventListener('click', async () => {
        const email = pinEmailInput.value.trim();
        const password = pinPassInput.value;

        if (!email || !password) {
            showToast("All fields are required.", false);
            return;
        }

        if (!cachedProfile || cachedProfile.user_data.email !== email || cachedProfile.password !== password) {
            showToast("Invalid security credentials.", false);
            return;
        }

        renderPinSetupScreen();
    });

    function renderPinSetupScreen() {
        pinFormCard.innerHTML = `
            <div class="form-header">
                <h3 class="form-title">Enter New PIN</h3>
                <button class="btn-close-form" onclick="document.getElementById('pinVerificationOverlay').classList.remove('active')"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <p style="font-size: 13px; color: var(--text-muted); text-align: center;">Set up a secure 4-digit transaction authority code.</p>
            <div class="pin-box-container">
                <input type="password" maxlength="1" class="pin-input-field" id="pin_1">
                <input type="password" maxlength="1" class="pin-input-field" id="pin_2">
                <input type="password" maxlength="1" class="pin-input-field" id="pin_3">
                <input type="password" maxlength="1" class="pin-input-field" id="pin_4">
            </div>
        `;

        const inputs = [
            document.getElementById('pin_1'),
            document.getElementById('pin_2'),
            document.getElementById('pin_3'),
            document.getElementById('pin_4')
        ];

        inputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                if (e.target.value.length === 1 && index < 3) {
                    inputs[index + 1].focus();
                }
                if (inputs.every(inp => inp.value.length === 1)) {
                    const finalPin = inputs.map(inp => inp.value).join('');
                    renderConfirmPinScreen(finalPin);
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === "Backspace" && e.target.value.length === 0 && index > 0) {
                    inputs[index - 1].focus();
                }
            });
        });

        inputs[0].focus();
    }

    function renderConfirmPinScreen(firstPin) {
        pinFormCard.innerHTML = `
            <div class="inner-loader">
                <div class="inner-loader-spinner"></div>
                <span style="font-size: 13px; color: var(--text-muted);">Verifying configuration...</span>
            </div>
        `;

        setTimeout(() => {
            pinFormCard.innerHTML = `
                <div class="form-header">
                    <h3 class="form-title">Confirm New PIN</h3>
                    <button class="btn-close-form" onclick="document.getElementById('pinVerificationOverlay').classList.remove('active')"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <p style="font-size: 13px; color: var(--text-muted); text-align: center;">Confirm your 4-digit transaction authority code.</p>
                <div class="pin-box-container">
                    <input type="password" maxlength="1" class="pin-input-field" id="cpin_1">
                    <input type="password" maxlength="1" class="pin-input-field" id="cpin_2">
                    <input type="password" maxlength="1" class="pin-input-field" id="cpin_3">
                    <input type="password" maxlength="1" class="pin-input-field" id="cpin_4">
                </div>
            `;

            const inputs = [
                document.getElementById('cpin_1'),
                document.getElementById('cpin_2'),
                document.getElementById('cpin_3'),
                document.getElementById('cpin_4')
            ];

            inputs.forEach((input, index) => {
                input.addEventListener('input', (e) => {
                    if (e.target.value.length === 1 && index < 3) {
                        inputs[index + 1].focus();
                    }
                    if (inputs.every(inp => inp.value.length === 1)) {
                        const confirmPin = inputs.map(inp => inp.value).join('');
                        if (firstPin === confirmPin) {
                            submitPinToAPI(confirmPin);
                        } else {
                            showToast("PIN matching error. Retrying.", false);
                            renderPinSetupScreen();
                        }
                    }
                });

                input.addEventListener('keydown', (e) => {
                    if (e.key === "Backspace" && e.target.value.length === 0 && index > 0) {
                        inputs[index - 1].focus();
                    }
                });
            });

            inputs[0].focus();
        }, 1200);
    }

    async function submitPinToAPI(pinValue) {
        pinFormCard.innerHTML = `
            <div class="inner-loader">
                <div class="inner-loader-spinner"></div>
                <span style="font-size: 13px; color: var(--text-muted);">Syncing secure pin...</span>
            </div>
        `;

        try {
            const response = await fetch('https://amandata.pages.dev/api/pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    password: '@haruna66',
                    uuid: cachedProfile.id,
                    pin: pinValue,
                    type: 'pin'
                })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                pinOverlay.classList.remove('active');
                showToast("Transaction PIN updated successfully!");
                triggerEmailNotification(cachedProfile.user_data.full_name, cachedProfile.user_data.email, "Transaction PIN");
            } else {
                throw new Error(result.message || "Endpoint error response");
            }
        } catch (error) {
            showToast("Transmission failure. Re-verify configuration.", false);
            pinOverlay.classList.remove('active');
        }
    }

    btnSubmitPassVerify.addEventListener('click', () => {
        const email = passEmailInput.value.trim();
        const currentPass = passOldInput.value;

        if (!email || !currentPass) {
            showToast("All credentials must be populated.", false);
            return;
        }

        if (!cachedProfile || cachedProfile.user_data.email !== email || cachedProfile.password !== currentPass) {
            showToast("Invalid credentials configuration.", false);
            return;
        }

        passwordStep1Fields.style.display = "none";
        passwordStep2Fields.style.display = "flex";
    });

    btnSubmitPassChange.addEventListener('click', async () => {
        const newPass = passNewInput.value;
        const confirmPass = passConfirmInput.value;

        if (!newPass || !confirmPass) {
            showToast("Please fill all password fields.", false);
            return;
        }

        if (newPass !== confirmPass) {
            showToast("Passwords mismatch.", false);
            return;
        }

        passwordStep2Fields.innerHTML = `
            <div class="inner-loader">
                <div class="inner-loader-spinner"></div>
                <span style="font-size: 13px; color: var(--text-muted);">Updating encryption data...</span>
            </div>
        `;

        try {
            const response = await fetch('https://amandata.pages.dev/api/pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    password: '@haruna66',
                    uuid: cachedProfile.id,
                    new_password: newPass,
                    type: 'password'
                })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                passOverlay.classList.remove('active');
                showToast("Password changed successfully!");
                cachedProfile.password = newPass;
                triggerEmailNotification(cachedProfile.user_data.full_name, cachedProfile.user_data.email, "Login Password");
            } else {
                throw new Error(result.message || "Endpoint authentication issue");
            }
        } catch (error) {
            showToast("Failed to change password. Retrying.", false);
            passOverlay.classList.remove('active');
        }
    });

    window.addEventListener('DOMContentLoaded', loadUserProfile);
})();
