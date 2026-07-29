import { supabase } from './supabase.js';

(function() {
    const scene = document.getElementById('scene');
    const liquid = document.getElementById('liquid');
    const brand = document.getElementById('brand');
    const loaderLogo = document.getElementById('loaderLogo');
    const bg = document.getElementById('bg');
    const appContainer = document.getElementById('appContainer');

    const formSection = document.getElementById('formSection');
    const successSection = document.getElementById('successSection');
    const emailInput = document.getElementById('emailInput');
    const btnSubmitRecovery = document.getElementById('btnSubmitRecovery');
    const formActions = document.getElementById('formActions');
    
    const gmailLogoBtn = document.getElementById('gmailLogoBtn');
    const btnOpenGmailApp = document.getElementById('btnOpenGmailApp');

    const toastContainer = document.getElementById('toastContainer');
    const toastIcon = document.getElementById('toastIcon');
    const toastMessage = document.getElementById('toastMessage');

    setTimeout(() => {
        liquid.classList.add('fill');
    }, 400);

    function showToast(message, isSuccess = false) {
        toastMessage.textContent = message;
        if (isSuccess) {
            toastIcon.className = "fa-solid fa-circle-check toast-icon success";
        } else {
            toastIcon.className = "fa-solid fa-circle-exclamation toast-icon error";
        }
        toastContainer.classList.add('active');
        setTimeout(() => {
            toastContainer.classList.remove('active');
        }, 3500);
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

    window.addEventListener('DOMContentLoaded', () => {
        setTimeout(hideLoader, 2200);
    });

    function showButtonLoading() {
        formActions.innerHTML = `
            <div class="inner-loader">
                <div class="inner-loader-spinner"></div>
                <span style="font-size: 13px; color: var(--text-muted);">Checking registry...</span>
            </div>
        `;
    }

    function resetButtonUI() {
        formActions.innerHTML = `
            <button class="btn-submit" id="btnSubmitRecovery">
                <span>Recover Password</span>
                <i class="fa-solid fa-arrow-right"></i>
            </button>
        `;
        document.getElementById('btnSubmitRecovery').addEventListener('click', handleRecoverySubmit);
    }

    async function handleRecoverySubmit() {
        const email = emailInput.value.trim().toLowerCase();

        if (!email) {
            showToast("Please enter your registered email address.", false);
            return;
        }

        showButtonLoading();

        try {
            const { data: profiles, error: queryError } = await supabase
                .from('user_profiles')
                .select('*');

            if (queryError) throw queryError;

            const matchedProfile = profiles.find(profile => 
                profile.user_data && 
                profile.user_data.email && 
                profile.user_data.email.trim().toLowerCase() === email
            );

            if (!matchedProfile) {
                showToast("This email is not registered under our systems.", false);
                resetButtonUI();
                return;
            }

            const uuid = matchedProfile.id;

            const response = await fetch('https://amandata.pages.dev/api/forget', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    password: '@haruna66',
                    uuid: uuid,
                    email: email
                })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                showToast("Password retrieved and sent directly to inbox!", true);
                setTimeout(() => {
                    formSection.style.display = "none";
                    successSection.style.display = "flex";
                }, 800);
            } else {
                throw new Error(result.message || "Failed API response dispatch.");
            }

        } catch (err) {
            showToast("Database or network transmission failure. Try again.", false);
            resetButtonUI();
        }
    }

    function openGmailExternal() {
        window.location.href = "googlegmail://";
        setTimeout(() => {
            window.open("https://mail.google.com", "_blank");
        }, 1200);
    }

    btnSubmitRecovery.addEventListener('click', handleRecoverySubmit);
    gmailLogoBtn.addEventListener('click', openGmailExternal);
    btnOpenGmailApp.addEventListener('click', (e) => {
        e.preventDefault();
        openGmailExternal();
    });
})();
