import { supabase } from './supabase.js';

(function() {
    const scene = document.getElementById('scene');
    const liquid = document.getElementById('liquid');
    const brand = document.getElementById('brand');
    const loaderLogo = document.getElementById('loaderLogo');
    const bg = document.getElementById('bg');
    const appContainer = document.getElementById('appContainer');

    const refLinkElement = document.getElementById('referral_link');
    const refCodeElement = document.getElementById('referral_code');
    const btnCopyLink = document.getElementById('btnCopyLink');
    const btnCopyCode = document.getElementById('btnCopyCode');
    const qrContainer = document.getElementById('qrcode');

    const toastContainer = document.getElementById('toastContainer');
    const toastIcon = document.getElementById('toastIcon');
    const toastMessage = document.getElementById('toastMessage');

    const sessionTokenString = localStorage.getItem('puredata_user_session');

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

    async function initializeReferralSystem() {
        if (!sessionTokenString) {
            window.location.replace('register.html');
            return;
        }

        const activeSession = JSON.parse(sessionTokenString);
        let userUUID = activeSession.id;
        let referralCode = "";

        try {
            const { data: profiles, error } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('id', userUUID);

            if (error) throw error;

            if (!profiles || profiles.length === 0) {
                localStorage.removeItem('puredata_user_session');
                window.location.replace('register.html');
                return;
            }

            const profileData = profiles[0].user_data;
            referralCode = profileData.phone ? profileData.phone.slice(-6).toUpperCase() : userUUID.slice(0, 6).toUpperCase();

            localStorage.setItem('puredata_user_ref_code', referralCode);
            localStorage.setItem('puredata_user_uuid', userUUID);

        } catch (err) {
            const cachedCode = localStorage.getItem('puredata_user_ref_code');
            const cachedUUID = localStorage.getItem('puredata_user_uuid');
            
            if (cachedCode && cachedUUID) {
                referralCode = cachedCode;
                userUUID = cachedUUID;
            } else {
                showToast("Failed to sync your profile. Try again.", false);
                hideLoader();
                return;
            }
        }

        const fallbackOrigin = window.location.origin || "https://www.amandata.com.ng";
        const cleanPath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/')) || "";
        const finalReferralUrl = `${fallbackOrigin}${cleanPath}/register.html?ref=${referralCode}`;

        refCodeElement.textContent = referralCode;
        refLinkElement.textContent = finalReferralUrl;

        qrContainer.innerHTML = "";
        new QRCode(qrContainer, {
            text: finalReferralUrl,
            width: 140,
            height: 140,
            colorDark: "#0f172a",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });

        btnCopyLink.addEventListener('click', () => {
            navigator.clipboard.writeText(finalReferralUrl).then(() => {
                showToast("Referral Link copied successfully!");
            }).catch(() => {
                showToast("Unable to copy link.", false);
            });
        });

        btnCopyCode.addEventListener('click', () => {
            navigator.clipboard.writeText(referralCode).then(() => {
                showToast("Referral Code copied successfully!");
            }).catch(() => {
                showToast("Unable to copy code.", false);
            });
        });

        setTimeout(hideLoader, 2200);
    }

    window.addEventListener('DOMContentLoaded', initializeReferralSystem);
})();
