import { supabase } from './supabase.js';

(function () {

    const SESSION_KEY = 'puredata_user_session';
    const PARTNER_CACHE_KEY = 'puredata_partner_button_cache';
    const ADS_CACHE_KEY = 'puredata_seen_ads';
    const REQUEST_TIMEOUT = 8000;

    function goToRegister() {
        try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
        window.location.replace('register.html');
    }

    let activeSession = null;
    try {
        const sessionTokenString = localStorage.getItem(SESSION_KEY);
        if (sessionTokenString) activeSession = JSON.parse(sessionTokenString);
    } catch (e) {
        activeSession = null;
    }

    if (!activeSession) {
        goToRegister();
        return;
    }

    const currentUserId = activeSession.userId || activeSession.id;

    if (!currentUserId) {
        goToRegister();
        return;
    }

    const openMenuBtn = document.getElementById('openMenuBtn');
    const closeMenuBtn = document.getElementById('closeMenuBtn');
    const sidebarMenuDrawer = document.getElementById('sidebarMenuDrawer');
    const openAlertsBtn = document.getElementById('openAlertsBtn');
    const closeAlertsBtn = document.getElementById('closeAlertsBtn');
    const alertsModalView = document.getElementById('alertsModalView');
    const triggerHelpModal = document.getElementById('triggerHelpModal');
    const closeHelpModal = document.getElementById('closeHelpModal');
    const helpModalView = document.getElementById('helpModalView');
    const accountLogoutTrigger = document.getElementById('accountLogoutTrigger');
    const toggleBalanceVisibility = document.getElementById('toggleBalanceVisibility');
    const walletBalanceDisplay = document.getElementById('walletBalanceDisplay');
    const userGreetingDisplay = document.getElementById('userGreetingDisplay');
    const virtualAccountsContainer = document.getElementById('virtualAccountsContainer');
    const alertsItemsContainer = document.getElementById('alertsItemsContainer');
    const alertCounter = document.getElementById('alertCounter');
    const appUniversalLoader = document.getElementById('appUniversalLoader');
    const liquidLoaderFill = document.getElementById('liquidLoaderFill');
    const adBannerImage = document.getElementById('adBannerImage');
    const adBannerWrapper = document.getElementById('adBannerWrapper');
    const toastNotificationBox = document.getElementById('toastNotificationBox');
    const partnerButtonWrapper = document.getElementById('partnerButtonWrapper');
    const partnerButtonLink = document.getElementById('partnerButtonLink');
    const partnerButtonImage = document.getElementById('partnerButtonImage');

    let cachedRealBalance = "0.00";
    let isBalanceMasked = false;
    let localNotificationsArray = [];
    let isSyncing = false;
    let loaderHidden = false;

    function withTimeout(promise, ms) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('timeout')), ms);
            Promise.resolve(promise).then(
                (value) => { clearTimeout(timer); resolve(value); },
                (error) => { clearTimeout(timer); reject(error); }
            );
        });
    }

    function showDataAlert(message) {
        try {
            if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return;

            if (Notification.permission === 'granted') {
                navigator.serviceWorker.getRegistration().then((registration) => {
                    if (registration) {
                        registration.showNotification('AmanData warning!', {
                            body: message,
                            icon: 'https://i.imgur.com/gv5b3VT.png',
                            badge: 'https://i.imgur.com/gv5b3VT.png',
                            vibrate: [200, 100, 200]
                        });
                    }
                }).catch(() => {});
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission();
            }
        } catch (e) {}
    }

    try {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

        if (connection) {
            const checkDataUsage = function () {
                if (connection.saveData) {
                    showDataAlert("Data Saver: Turn it on to reduce image loading and save your mobile data.");
                }
                if (connection.effectiveType === '2g' || connection.effectiveType === '3g') {
                    showDataAlert("Notice: Your internet speed is slow. Please ensure you have sufficient mobile data.");
                }
            };

            if (connection.addEventListener) connection.addEventListener('change', checkDataUsage);
            checkDataUsage();
        }
    } catch (e) {}

    function showToastNotification(text) {
        if (!toastNotificationBox) return;
        toastNotificationBox.textContent = text;
        toastNotificationBox.classList.add('visible');
        setTimeout(() => { toastNotificationBox.classList.remove('visible'); }, 3000);
    }

    function toggleLoaderDisplay(visible) {
        if (!appUniversalLoader || !liquidLoaderFill) return;

        if (visible) {
            if (loaderHidden) return;
            appUniversalLoader.classList.remove('hidden');
            setTimeout(() => { liquidLoaderFill.style.height = '100%'; }, 50);
        } else {
            loaderHidden = true;
            liquidLoaderFill.style.height = '0%';
            setTimeout(() => { appUniversalLoader.classList.add('hidden'); }, 600);
        }
    }

    function formatNaira(value) {
        const number = parseFloat(value);
        const safeNumber = isNaN(number) ? 0 : number;
        return `₦${safeNumber.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    if (openMenuBtn && sidebarMenuDrawer) openMenuBtn.addEventListener('click', () => sidebarMenuDrawer.classList.add('active'));
    if (closeMenuBtn && sidebarMenuDrawer) closeMenuBtn.addEventListener('click', () => sidebarMenuDrawer.classList.remove('active'));

    if (sidebarMenuDrawer) {
        sidebarMenuDrawer.addEventListener('click', (e) => {
            if (e.target === sidebarMenuDrawer) sidebarMenuDrawer.classList.remove('active');
        });
    }

    if (openAlertsBtn && alertsModalView) {
        openAlertsBtn.addEventListener('click', () => {
            alertsModalView.classList.add('active');
            if (localNotificationsArray.length > 0) {
                localNotificationsArray = [];
                if (alertCounter) alertCounter.textContent = "0";
            }
        });
    }

    if (closeAlertsBtn && alertsModalView) {
        closeAlertsBtn.addEventListener('click', () => {
            alertsModalView.classList.remove('active');
            if (alertsItemsContainer) {
                alertsItemsContainer.innerHTML = `<div style="text-align:center; color:#94a3b8; font-size:13px; padding:20px 0;">No new notifications</div>`;
            }
        });
    }

    if (triggerHelpModal && helpModalView) {
        triggerHelpModal.addEventListener('click', (e) => {
            e.preventDefault();
            helpModalView.classList.add('active');
        });
    }

    if (closeHelpModal && helpModalView) closeHelpModal.addEventListener('click', () => helpModalView.classList.remove('active'));

    document.querySelectorAll('.support-agent-row').forEach((row) => {
        row.addEventListener('click', function () {
            const phoneNumber = (this.getAttribute('data-phone') || '').replace('+', '');
            const messageBody = this.getAttribute('data-msg') || '';
            window.open(`https://wa.me/${phoneNumber}?text=${encodeURIComponent(messageBody)}`, '_blank');
        });
    });

    if (accountLogoutTrigger) {
        accountLogoutTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            goToRegister();
        });
    }

    if (toggleBalanceVisibility && walletBalanceDisplay) {
        toggleBalanceVisibility.addEventListener('click', () => {
            isBalanceMasked = !isBalanceMasked;

            if (isBalanceMasked) {
                walletBalanceDisplay.textContent = "••••";
                toggleBalanceVisibility.classList.remove('fa-eye');
                toggleBalanceVisibility.classList.add('fa-eye-slash');
            } else {
                walletBalanceDisplay.textContent = formatNaira(cachedRealBalance);
                toggleBalanceVisibility.classList.remove('fa-eye-slash');
                toggleBalanceVisibility.classList.add('fa-eye');
            }
        });
    }

    function executeVirtualStringCopy(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    showToastNotification("Account number copied successfully!");
                }).catch(() => {});
                return;
            }

            const temp = document.createElement('textarea');
            temp.value = text;
            temp.style.position = 'fixed';
            temp.style.opacity = '0';
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            document.body.removeChild(temp);
            showToastNotification("Account number copied successfully!");
        } catch (e) {}
    }

    function triggerAudioNotificationAlert() {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return;
            const audioCtx = new AudioContextClass();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.15);
        } catch (e) {}
    }

    function pushClientNotificationMessage(text, type = 'general') {
        localNotificationsArray.unshift({ text, type, timestamp: new Date() });
        if (alertCounter) alertCounter.textContent = localNotificationsArray.length;

        const rowNode = document.createElement('div');
        rowNode.className = `alert-entry ${type}`;
        rowNode.innerHTML = `<p class="alert-body-text">${escapeHtml(text)}</p>`;

        if (alertsItemsContainer) {
            if (alertsItemsContainer.firstChild && alertsItemsContainer.firstChild.textContent.trim() === "No new notifications") {
                alertsItemsContainer.innerHTML = "";
            }
            alertsItemsContainer.insertBefore(rowNode, alertsItemsContainer.firstChild);
        }

        triggerAudioNotificationAlert();
        showToastNotification(text);
    }

    function parseJsonbValue(raw) {
        if (!raw) return {};
        if (typeof raw === 'string') {
            try {
                return JSON.parse(raw) || {};
            } catch (e) {
                return {};
            }
        }
        return raw;
    }

    function readPartnerCache() {
        try {
            return JSON.parse(localStorage.getItem(PARTNER_CACHE_KEY) || 'null');
        } catch (e) {
            return null;
        }
    }

    function renderPartnerButton(imageUrl, openLink) {
        if (!partnerButtonWrapper || !partnerButtonLink || !partnerButtonImage) return;

        if (!imageUrl) {
            partnerButtonWrapper.classList.remove('visible');
            partnerButtonImage.removeAttribute('src');
            return;
        }

        if (partnerButtonImage.getAttribute('src') !== imageUrl) {
            partnerButtonImage.src = imageUrl;
        }

        if (openLink) {
            partnerButtonLink.setAttribute('href', openLink);
            partnerButtonLink.setAttribute('target', '_blank');
            partnerButtonLink.setAttribute('rel', 'noopener noreferrer');
            partnerButtonLink.style.pointerEvents = 'auto';
        } else {
            partnerButtonLink.setAttribute('href', '#');
            partnerButtonLink.style.pointerEvents = 'none';
        }

        partnerButtonImage.onerror = function () {
            partnerButtonWrapper.classList.remove('visible');
        };

        partnerButtonWrapper.classList.add('visible');
    }

    async function loadPartnerButton() {
        if (!partnerButtonWrapper) return;

        const cached = readPartnerCache();

        if (cached && cached.imageUrl) {
            renderPartnerButton(cached.imageUrl, cached.openLink);
        }

        try {
            const { data, error } = await withTimeout(supabase.from('patner').select('*'), REQUEST_TIMEOUT);

            if (error) throw error;

            if (!data || data.length === 0) {
                try { localStorage.removeItem(PARTNER_CACHE_KEY); } catch (e) {}
                renderPartnerButton(null, null);
                return;
            }

            const row = data[0];
            const bottonData = parseJsonbValue(row.botton);

            const imageUrl = row.imageUrl || bottonData.url || bottonData.imageUrl || '';
            const openLink = row.OpenLink || bottonData.link || bottonData.OpenLink || '';

            const freshSignature = JSON.stringify({ imageUrl, openLink });
            const cachedSignature = cached ? JSON.stringify({ imageUrl: cached.imageUrl, openLink: cached.openLink }) : null;

            if (freshSignature !== cachedSignature) {
                try { localStorage.setItem(PARTNER_CACHE_KEY, freshSignature); } catch (e) {}
                renderPartnerButton(imageUrl, openLink);
            } else if (imageUrl) {
                partnerButtonWrapper.classList.add('visible');
            }
        } catch (e) {
            if (!cached || !cached.imageUrl) {
                partnerButtonWrapper.classList.remove('visible');
            }
        }
    }

    async function loadMarketingCampaignBanner() {
        if (!adBannerImage || !adBannerWrapper) return;

        try {
            const { data: ads, error } = await withTimeout(supabase.from('ad_image').select('*'), REQUEST_TIMEOUT);

            if (error) throw error;

            if (ads && ads.length > 0) {
                let seenAdsIdsArray = [];
                try {
                    seenAdsIdsArray = JSON.parse(localStorage.getItem(ADS_CACHE_KEY) || '[]');
                    if (!Array.isArray(seenAdsIdsArray)) seenAdsIdsArray = [];
                } catch (e) {
                    seenAdsIdsArray = [];
                }

                let targetAd = ads.find((item) => !seenAdsIdsArray.includes(item.id));

                if (!targetAd) {
                    seenAdsIdsArray = [];
                    try { localStorage.setItem(ADS_CACHE_KEY, '[]'); } catch (e) {}
                    targetAd = ads[0];
                }

                const adContent = parseJsonbValue(targetAd.ad_image);
                const resolvedUrl = typeof targetAd.ad_image === 'string' && targetAd.ad_image.indexOf('{') !== 0
                    ? targetAd.ad_image
                    : adContent.url;

                if (resolvedUrl) {
                    if (adBannerImage.getAttribute('src') !== resolvedUrl) {
                        adBannerImage.src = resolvedUrl;
                    }

                    adBannerWrapper.onclick = () => {
                        if (adContent.link) {
                            window.open(adContent.link, '_blank');
                        }
                    };

                    if (!seenAdsIdsArray.includes(targetAd.id)) {
                        seenAdsIdsArray.push(targetAd.id);
                        try { localStorage.setItem(ADS_CACHE_KEY, JSON.stringify(seenAdsIdsArray)); } catch (e) {}
                    }
                }
            }
        } catch (e) {}
    }

    function renderVirtualAccounts(accounts) {
        if (!virtualAccountsContainer) return;

        virtualAccountsContainer.innerHTML = "";

        if (accounts.length > 0) {
            accounts.forEach((acc) => {
                const tile = document.createElement('div');
                tile.className = "account-tile";
                tile.innerHTML = `
                    <div class="account-meta-info">
                        <span class="bank-title-lbl">${escapeHtml(acc.bankName)}</span>
                        <span class="bank-num-string">${escapeHtml(acc.accountNumber)}</span>
                    </div>
                    <i class="fa-regular fa-copy bank-copy-icon"></i>
                `;
                tile.querySelector('.bank-copy-icon').addEventListener('click', () => executeVirtualStringCopy(acc.accountNumber));
                virtualAccountsContainer.appendChild(tile);
            });
        } else {
            virtualAccountsContainer.innerHTML = `
                <div style="text-align:center; padding:10px; font-size:12px; color:#64748b; font-weight:500;">
                    <i class="fa-solid fa-triangle-exclamation"></i> Virtual Accounts generating...
                </div>`;
        }
    }

    async function synchronousDashboardStateSync(showLoader = false) {
        if (isSyncing) return;
        isSyncing = true;

        if (showLoader) toggleLoaderDisplay(true);

        try {
            const { data: profiles, error } = await withTimeout(
                supabase.from('user_profiles').select('*').eq('id', currentUserId),
                REQUEST_TIMEOUT
            );

            if (error) throw error;

            if (!profiles || profiles.length === 0) {
                goToRegister();
                return;
            }

            const payloadData = parseJsonbValue(profiles[0].user_data);

            if (userGreetingDisplay && payloadData.full_name) {
                userGreetingDisplay.textContent = `Hello, ${String(payloadData.full_name).split(' ')[0]} 👋`;
            }

            const incomingBalance = String(payloadData.user_balance || "0.00");

            if (incomingBalance !== cachedRealBalance) {
                const oldBalance = parseFloat(cachedRealBalance) || 0;
                const newBalance = parseFloat(incomingBalance) || 0;
                cachedRealBalance = incomingBalance;

                if (!isBalanceMasked && walletBalanceDisplay) {
                    walletBalanceDisplay.textContent = formatNaira(newBalance);
                }

                if (oldBalance > 0 || incomingBalance !== "0.00") {
                    if (oldBalance < newBalance) {
                        const diff = newBalance - oldBalance;
                        pushClientNotificationMessage(`AmanData account you get +₦${diff.toFixed(2)}. Your main balance: ₦${newBalance.toFixed(2)}`, 'income');
                    } else if (oldBalance > newBalance) {
                        const diff = oldBalance - newBalance;
                        pushClientNotificationMessage(`AmanData account you withdraw -₦${diff.toFixed(2)}. Your main balance: ₦${newBalance.toFixed(2)}`, 'expense');
                    }
                }
            }

            renderVirtualAccounts(Array.isArray(payloadData.virtual_accounts) ? payloadData.virtual_accounts : []);

            if (showLoader) toggleLoaderDisplay(false);

            loadMarketingCampaignBanner();
            loadPartnerButton();

        } catch (err) {
            showToastNotification("Network is slow. Please check your connection.");
        } finally {
            if (showLoader) toggleLoaderDisplay(false);
            isSyncing = false;
        }
    }

    function startDashboard() {
        if (alertsItemsContainer) {
            alertsItemsContainer.innerHTML = `<div style="text-align:center; color:#94a3b8; font-size:13px; padding:20px 0;">No new notifications</div>`;
        }

        synchronousDashboardStateSync(true);

        setInterval(() => {
            synchronousDashboardStateSync(false);
        }, 10000);
    }

    setTimeout(() => { toggleLoaderDisplay(false); }, 10000);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startDashboard);
    } else {
        startDashboard();
    }

})();
