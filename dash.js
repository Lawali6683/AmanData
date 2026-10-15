import { supabase } from './supabase.js';

(function () {
    const SESSION_KEY = 'puredata_user_session';
    const PARTNER_CACHE_KEY = 'puredata_partner_button_cache';
    const ADS_CACHE_KEY = 'puredata_seen_ads';
    const SYNC_INTERVAL_MS = 10000;

    function readSession() {
        try {
            return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        } catch (e) {
            return null;
        }
    }

    function redirectToRegister() {
        localStorage.removeItem(SESSION_KEY);
        window.location.replace('register.html');
    }

    const activeSession = readSession();
    const currentUserId = activeSession && (activeSession.userId || activeSession.id);

    if (!currentUserId) {
        redirectToRegister();
        return;
    }

    const BALANCE_KEY = 'amandata_last_balance_' + currentUserId;

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

    let cachedRealBalance = 0;
    let isBalanceMasked = false;
    let localNotificationsArray = [];
    let accountsSignature = '';
    let isSyncing = false;
    let toastTimer = null;

    function formatNaira(value) {
        return '₦' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function readLastBalance() {
        const raw = localStorage.getItem(BALANCE_KEY);
        if (raw === null) return null;
        const parsed = parseFloat(raw);
        return isNaN(parsed) ? null : parsed;
    }

    function writeLastBalance(value) {
        try {
            localStorage.setItem(BALANCE_KEY, String(value));
        } catch (e) {}
    }

    function renderBalance() {
        if (!walletBalanceDisplay) return;
        walletBalanceDisplay.textContent = isBalanceMasked ? '••••' : formatNaira(cachedRealBalance);
    }

    function showToastNotification(text) {
        if (!toastNotificationBox) return;
        toastNotificationBox.textContent = text;
        toastNotificationBox.classList.add('visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastNotificationBox.classList.remove('visible'); }, 3000);
    }

    function showDataAlert(key, message) {
        if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return;

        const storageKey = 'amandata_data_alert_' + key;

        try {
            if (sessionStorage.getItem(storageKey) === '1') return;
            sessionStorage.setItem(storageKey, '1');
        } catch (e) {}

        if (Notification.permission === 'granted') {
            navigator.serviceWorker.ready.then(function (registration) {
                registration.showNotification('AmanData warning!', {
                    body: message,
                    icon: 'https://i.imgur.com/gv5b3VT.png',
                    badge: 'https://i.imgur.com/gv5b3VT.png',
                    vibrate: [200, 100, 200]
                });
            }).catch(function () {});
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }

    function checkDataUsage() {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!connection) return;

        if (connection.saveData) {
            showDataAlert('saver', 'Data Saver: Turn it on to reduce image loading and save your mobile data.');
        }

        if (connection.effectiveType === '2g' || connection.effectiveType === '3g') {
            showDataAlert('slow', 'Notice: Your internet speed is slow. Please ensure you have sufficient mobile data.');
        }
    }

    function toggleLoaderDisplay(visible) {
        if (!appUniversalLoader || !liquidLoaderFill) return;

        if (visible) {
            appUniversalLoader.classList.remove('hidden');
            setTimeout(() => { liquidLoaderFill.style.height = '100%'; }, 50);
        } else {
            liquidLoaderFill.style.height = '0%';
            setTimeout(() => { appUniversalLoader.classList.add('hidden'); }, 600);
        }
    }

    function renderEmptyAlerts() {
        if (!alertsItemsContainer) return;
        alertsItemsContainer.innerHTML = '<div class="alerts-empty">No new notifications</div>';
    }

    function triggerAudioNotificationAlert() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

        if (alertsItemsContainer) {
            const emptyNode = alertsItemsContainer.querySelector('.alerts-empty');
            if (emptyNode) emptyNode.remove();

            const rowNode = document.createElement('div');
            rowNode.className = 'alert-entry ' + type;

            const textNode = document.createElement('p');
            textNode.className = 'alert-body-text';
            textNode.textContent = text;

            rowNode.appendChild(textNode);
            alertsItemsContainer.insertBefore(rowNode, alertsItemsContainer.firstChild);
        }

        triggerAudioNotificationAlert();
        showToastNotification(text);
    }

    function copyTextFallback(text) {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try {
            document.execCommand('copy');
            showToastNotification('Account number copied successfully!');
        } catch (e) {}
        document.body.removeChild(area);
    }

    function executeVirtualStringCopy(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showToastNotification('Account number copied successfully!');
            }).catch(() => { copyTextFallback(text); });
        } else {
            copyTextFallback(text);
        }
    }

    function renderVirtualAccounts(accounts) {
        if (!virtualAccountsContainer) return;

        const signature = JSON.stringify(accounts);
        if (signature === accountsSignature) return;
        accountsSignature = signature;

        virtualAccountsContainer.innerHTML = '';

        if (!accounts.length) {
            virtualAccountsContainer.innerHTML = '<div class="accounts-empty"><i class="fa-solid fa-triangle-exclamation"></i> Virtual Accounts generating...</div>';
            return;
        }

        accounts.forEach(acc => {
            const tile = document.createElement('div');
            tile.className = 'account-tile';

            const meta = document.createElement('div');
            meta.className = 'account-meta-info';

            const bank = document.createElement('span');
            bank.className = 'bank-title-lbl';
            bank.textContent = acc.bankName;

            const number = document.createElement('span');
            number.className = 'bank-num-string';
            number.textContent = acc.accountNumber;

            const copyIcon = document.createElement('i');
            copyIcon.className = 'fa-regular fa-copy bank-copy-icon';
            copyIcon.addEventListener('click', () => executeVirtualStringCopy(String(acc.accountNumber)));

            meta.appendChild(bank);
            meta.appendChild(number);
            tile.appendChild(meta);
            tile.appendChild(copyIcon);
            virtualAccountsContainer.appendChild(tile);
        });
    }

    function handleBalanceUpdate(rawBalance) {
        const parsed = parseFloat(rawBalance);
        const newBalance = isNaN(parsed) ? 0 : parsed;
        const previousBalance = readLastBalance();

        cachedRealBalance = newBalance;
        renderBalance();

        if (previousBalance !== null && Math.abs(newBalance - previousBalance) >= 0.005) {
            const diff = Math.abs(newBalance - previousBalance);

            if (newBalance > previousBalance) {
                pushClientNotificationMessage('AmanData account you get +₦' + diff.toFixed(2) + '. Your main balance: ₦' + newBalance.toFixed(2), 'income');
            } else {
                pushClientNotificationMessage('AmanData account you withdraw -₦' + diff.toFixed(2) + '. Your main balance: ₦' + newBalance.toFixed(2), 'expense');
            }
        }

        writeLastBalance(newBalance);
    }

    function parseJsonbValue(raw) {
        if (!raw) return {};
        if (typeof raw === 'string') {
            try {
                return JSON.parse(raw);
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
            const { data, error } = await supabase
                .from('patner')
                .select('*');

            if (error) throw error;

            if (!data || data.length === 0) {
                localStorage.removeItem(PARTNER_CACHE_KEY);
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
                localStorage.setItem(PARTNER_CACHE_KEY, freshSignature);
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
            const { data: ads, error } = await supabase
                .from('ad_image')
                .select('*');

            if (error) throw error;

            if (!ads || ads.length === 0) return;

            let seenAdsIdsArray = [];
            try {
                seenAdsIdsArray = JSON.parse(localStorage.getItem(ADS_CACHE_KEY) || '[]');
            } catch (e) {
                seenAdsIdsArray = [];
            }

            let targetAd = ads.find(item => !seenAdsIdsArray.includes(item.id));

            if (!targetAd) {
                seenAdsIdsArray = [];
                localStorage.setItem(ADS_CACHE_KEY, '[]');
                targetAd = ads[0];
            }

            const adContent = targetAd.ad_image;

            if (adContent) {
                const resolvedUrl = adContent.url || adContent;

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
                    localStorage.setItem(ADS_CACHE_KEY, JSON.stringify(seenAdsIdsArray));
                }
            }
        } catch (e) {}
    }

    async function synchronousDashboardStateSync(showLoader = false) {
        if (isSyncing) return;
        isSyncing = true;

        if (showLoader) toggleLoaderDisplay(true);

        try {
            const { data: profiles, error } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('id', currentUserId);

            if (error) throw error;

            if (!profiles || profiles.length === 0) {
                redirectToRegister();
                return;
            }

            const payloadData = profiles[0].user_data || {};

            if (userGreetingDisplay && payloadData.full_name) {
                userGreetingDisplay.textContent = 'Hello, ' + String(payloadData.full_name).split(' ')[0] + ' 👋';
            }

            handleBalanceUpdate(payloadData.user_balance);
            renderVirtualAccounts(payloadData.virtual_accounts || []);

            loadMarketingCampaignBanner();
            loadPartnerButton();
        } catch (err) {
            if (showLoader) showToastNotification('Unable to refresh your account. Please check your connection.');
        } finally {
            isSyncing = false;
            if (showLoader) toggleLoaderDisplay(false);
        }
    }

    if (openMenuBtn && sidebarMenuDrawer) {
        openMenuBtn.addEventListener('click', () => sidebarMenuDrawer.classList.add('active'));
    }

    if (closeMenuBtn && sidebarMenuDrawer) {
        closeMenuBtn.addEventListener('click', () => sidebarMenuDrawer.classList.remove('active'));
    }

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
                if (alertCounter) alertCounter.textContent = '0';
            }
        });
    }

    if (closeAlertsBtn && alertsModalView) {
        closeAlertsBtn.addEventListener('click', () => {
            alertsModalView.classList.remove('active');
            renderEmptyAlerts();
        });
    }

    if (triggerHelpModal && helpModalView) {
        triggerHelpModal.addEventListener('click', (e) => {
            e.preventDefault();
            helpModalView.classList.add('active');
        });
    }

    if (closeHelpModal && helpModalView) {
        closeHelpModal.addEventListener('click', () => helpModalView.classList.remove('active'));
    }

    document.querySelectorAll('.support-agent-row').forEach(row => {
        row.addEventListener('click', function () {
            const phoneNumber = this.getAttribute('data-phone');
            const messageBody = this.getAttribute('data-msg');
            window.open('https://wa.me/' + phoneNumber + '?text=' + encodeURIComponent(messageBody), '_blank');
        });
    });

    if (accountLogoutTrigger) {
        accountLogoutTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            redirectToRegister();
        });
    }

    if (toggleBalanceVisibility && walletBalanceDisplay) {
        toggleBalanceVisibility.addEventListener('click', () => {
            isBalanceMasked = !isBalanceMasked;
            toggleBalanceVisibility.classList.toggle('fa-eye-slash', isBalanceMasked);
            toggleBalanceVisibility.classList.toggle('fa-eye', !isBalanceMasked);
            renderBalance();
        });
    }

    function startDashboard() {
        renderEmptyAlerts();
        checkDataUsage();

        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (connection && connection.addEventListener) {
            connection.addEventListener('change', checkDataUsage);
        }

        synchronousDashboardStateSync(true);

        setInterval(() => {
            if (!document.hidden) synchronousDashboardStateSync(false);
        }, SYNC_INTERVAL_MS);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) synchronousDashboardStateSync(false);
        });
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', startDashboard);
    } else {
        startDashboard();
    }
})();
