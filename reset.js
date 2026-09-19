import { supabase } from './supabase.js';

(function() {
    const appContainer = document.getElementById('appContainer');
    const formSection = document.getElementById('formSection');
    const newPasswordInput = document.getElementById('newPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const toggleNew = document.getElementById('toggleNew');
    const toggleConfirm = document.getElementById('toggleConfirm');
    const formActions = document.getElementById('formActions');
    const btnSubmitReset = document.getElementById('btnSubmitReset');
    const notificationContainer = document.getElementById('notificationContainer');

    let sessionReady = false;

    window.addEventListener('DOMContentLoaded', async () => {
        appContainer.classList.add('ready');

        const { data, error } = await supabase.auth.getSession();

        if (error || !data.session) {
            try {
                const result = await supabase.auth.exchangeCodeForSession(window.location.href);
                sessionReady = !!result.data.session;
            } catch (e) {
                sessionReady = false;
            }
        } else {
            sessionReady = true;
        }

        if (!sessionReady) {
            formActions.innerHTML = `
                <div class="inner-loader">
                    <i class="fa-solid fa-circle-exclamation" style="font-size: 24px; color: var(--danger);"></i>
                    <span style="font-size: 13px; color: var(--text-muted);">This reset link is invalid or has expired. Please request a new one.</span>
                </div>
            `;
        }
    });

    function setupToggle(btn, input) {
        btn.addEventListener('click', () => {
            const isVisible = input.type === 'text';
            input.type = isVisible ? 'password' : 'text';
            btn.innerHTML = isVisible
                ? '<i class="fa-solid fa-eye"></i>'
                : '<i class="fa-solid fa-eye-slash"></i>';
        });
    }

    setupToggle(toggleNew, newPasswordInput);
    setupToggle(toggleConfirm, confirmPasswordInput);

    function showButtonLoading() {
        formActions.innerHTML = `
            <div class="inner-loader">
                <div class="inner-loader-spinner"></div>
                <span style="font-size: 13px; color: var(--text-muted);">Updating your password...</span>
            </div>
        `;
    }

    function resetButtonUI() {
        formActions.innerHTML = `
            <button class="btn-submit" id="btnSubmitReset">
                <span>Submit</span>
                <i class="fa-solid fa-check"></i>
            </button>
        `;
        document.getElementById('btnSubmitReset').addEventListener('click', handleResetSubmit);
    }

    async function handleResetSubmit() {
        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        if (!newPassword || !confirmPassword) {
            alert('Please fill in both password fields.');
            return;
        }

        if (newPassword.length < 6) {
            alert('Password must be at least 6 characters long.');
            return;
        }

        if (newPassword !== confirmPassword) {
            alert('Passwords do not match. Please try again.');
            return;
        }

        showButtonLoading();

        try {
            const { error } = await supabase.auth.updateUser({
                password: newPassword
            });

            if (error) throw error;

            formSection.style.display = 'none';
            notificationContainer.classList.add('active');

            setTimeout(() => {
                window.location.href = 'register.html';
            }, 3000);
        } catch (err) {
            resetButtonUI();
            alert('Failed to update password. The link may have expired. Please request a new reset link.');
        }
    }

    btnSubmitReset.addEventListener('click', handleResetSubmit);
})();
