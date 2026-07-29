import { supabase } from './supabase.js';
(function() {

    const sessionTokenString = localStorage.getItem('puredata_user_session');

    if (!sessionTokenString) {

        window.location.replace('register.html');

        return;

    }
    const activeSession = JSON.parse(sessionTokenString);

    const currentUserId = activeSession.userId || activeSession.id;
    if (!currentUserId) {

        localStorage.removeItem('puredata_user_session');

        window.location.replace('register.html');

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
    let cachedRealBalance = "0.00";

    let isBalanceMasked = false;

    let localNotificationsArray = [];

    if ('connection' in navigator) {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        
        function checkDataUsage() {
            if (connection.saveData) {
                showDataAlert("Data Saver: Turn it on to reduce image loading and save your mobile data.");
            }
            
            if (connection.effectiveType === '2g' || connection.effectiveType === '3g') {
                showDataAlert("Notice: Your internet speed is slow. Please ensure you have sufficient mobile data.");
            }
        }
        
        connection.addEventListener('change', checkDataUsage);
        checkDataUsage();
    }

    function showDataAlert(message) {
        if (Notification.permission === 'granted') {
            navigator.serviceWorker.ready.then(function(registration) {
                registration.showNotification('AmanData warning!', {
                    body: message,
                    icon: 'https://i.imgur.com/gv5b3VT.png',
                    badge: 'https://i.imgur.com/gv5b3VT.png',
                    vibrate: [200, 100, 200]
                });
            });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }

    function showToastNotification(text) {

        if (!toastNotificationBox) return;

        toastNotificationBox.textContent = text;

        toastNotificationBox.classList.add('visible');

        setTimeout(() => { toastNotificationBox.classList.remove('visible'); }, 3000);

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
    document.querySelectorAll('.support-agent-row').forEach(row => {

        row.addEventListener('click', function() {

            const phoneNumber = this.getAttribute('data-phone');

            const messageBody = this.getAttribute('data-msg');

            window.open(`https://wa.me/${phoneNumber}?text=${encodeURIComponent(messageBody)}`, '_blank');

        });

    });
    if (accountLogoutTrigger) {

        accountLogoutTrigger.addEventListener('click', (e) => {

            e.preventDefault();

            localStorage.removeItem('puredata_user_session');

            window.location.replace('register.html');

        });

    }
    if (toggleBalanceVisibility && walletBalanceDisplay) {

        toggleBalanceVisibility.addEventListener('click', () => {

            isBalanceMasked = !isBalanceMasked;

            if (isBalanceMasked) {

                walletBalanceDisplay.textContent = "••••";

                toggleBalanceVisibility.classList.replace('fa-eye', 'fa-eye-slash');

            } else {

                walletBalanceDisplay.textContent = `₦${parseFloat(cachedRealBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

                toggleBalanceVisibility.classList.replace('fa-eye-slash', 'fa-eye');

            }

        });

    }
    function executeVirtualStringCopy(text) {

        navigator.clipboard.writeText(text).then(() => {

            showToastNotification("Account number copied successfully!");

        }).catch(() => {});

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

        

        const rowNode = document.createElement('div');

        rowNode.className = `alert-entry ${type}`;

        rowNode.innerHTML = `<p class="alert-body-text">${text}</p>`;

        

        if (alertsItemsContainer) {

            if (alertsItemsContainer.firstChild && alertsItemsContainer.firstChild.innerText === "No new notifications") {

                alertsItemsContainer.innerHTML = "";

            }

            alertsItemsContainer.insertBefore(rowNode, alertsItemsContainer.firstChild);

        }

        triggerAudioNotificationAlert();

        showToastNotification(text);

    }
    async function synchronousDashboardStateSync(showLoader = false) {

        if (showLoader) toggleLoaderDisplay(true);

        try {

            const { data: profiles, error } = await supabase

                .from('user_profiles')

                .select('*')

                .eq('id', currentUserId);
            if (error) throw error;

            if (!profiles || profiles.length === 0) {

                localStorage.removeItem('puredata_user_session');

                window.location.replace('register.html');

                return;

            }
            const payloadData = profiles[0].user_data;

            if (userGreetingDisplay && payloadData.full_name) {

                userGreetingDisplay.textContent = `Hello, ${payloadData.full_name.split(' ')[0]} 👋`;

            }
            const incomingBalance = payloadData.user_balance || "0.00";

            if (incomingBalance !== cachedRealBalance) {

                const oldBalance = parseFloat(cachedRealBalance);

                const newBalance = parseFloat(incomingBalance);

                cachedRealBalance = incomingBalance;
                if (!isBalanceMasked && walletBalanceDisplay) {

                    walletBalanceDisplay.textContent = `₦${newBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
            if (virtualAccountsContainer) {

                virtualAccountsContainer.innerHTML = "";

                const accounts = payloadData.virtual_accounts || [];

                if (accounts.length > 0) {

                    accounts.forEach(acc => {

                        const tile = document.createElement('div');

                        tile.className = "account-tile";

                        tile.innerHTML = `

                            <div class="account-meta-info">

                                <span class="bank-title-lbl">${acc.bankName}</span>

                                <span class="bank-num-string">${acc.accountNumber}</span>

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

            await loadMarketingCampaignBanner();

        } catch (err) {

            showToastNotification("Sync engine validation tracking warning.");

        } finally {

            if (showLoader) toggleLoaderDisplay(false);

        }

    }
    async function loadMarketingCampaignBanner() {

        if (!adBannerImage || !adBannerWrapper) return;

        try {

            const { data: ads, error } = await supabase

                .from('ad_image')

                .select('*');

            if (error) throw error;

            if (ads && ads.length > 0) {

                const seenAdsIdsArray = JSON.parse(localStorage.getItem('puredata_seen_ads') || '[]');

                let targetAd = ads.find(item => !seenAdsIdsArray.includes(item.id));

                if (!targetAd) {

                    localStorage.setItem('puredata_seen_ads', '[]');

                    targetAd = ads[0];

                }

                const adContent = targetAd.ad_image;

                if (adContent) {

                    adBannerImage.src = adContent.url || adContent;

                    adBannerWrapper.onclick = () => {

                        if (adContent.link) {

                            window.open(adContent.link, '_blank');

                        }

                    };

                    if (!seenAdsIdsArray.includes(targetAd.id)) {

                        seenAdsIdsArray.push(targetAd.id);

                        localStorage.setItem('puredata_seen_ads', JSON.stringify(seenAdsIdsArray));

                    }

                }

            }

        } catch (e) {}

    }
    window.addEventListener('DOMContentLoaded', () => {

        if (alertsItemsContainer) {

            alertsItemsContainer.innerHTML = `<div style="text-align:center; color:#94a3b8; font-size:13px; padding:20px 0;">No new notifications</div>`;

        }

        synchronousDashboardStateSync(true);

        setInterval(() => {

            synchronousDashboardStateSync(false);

        }, 10000);

    });
})();
