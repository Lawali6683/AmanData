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
        toastIcon.className = isSuccess
            ? "fa-solid fa-circle-check toast-icon success"
            : "fa-solid fa-circle-exclamation toast-icon error";
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
                <span style="font-size: 13px; color: var(--text-muted);">Sending reset link...</span>
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

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showToast("Please enter a valid email address.", false);
            return;
        }

        showButtonLoading();

        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + '/reset.html'
            });

            if (error) throw error;

            showToast("Reset link sent to your email!", true);
            setTimeout(() => {
                formSection.style.display = "none";
                successSection.style.display = "flex";
            }, 800);
        } catch (err) {
            showToast("Failed to send reset link. Please try again.", false);
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
