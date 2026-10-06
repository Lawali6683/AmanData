(function () {
    const APP_VERSION = '2026-10-06-1';
    const VERSION_KEY = 'amandata_app_version';
    const SESSION_KEY = 'puredata_user_session';
    const PARTNER_CACHE_KEY = 'puredata_partner_button_cache';
    const ADS_CACHE_KEY = 'puredata_seen_ads';
    const REQUEST_TIMEOUT = 15000;
    const SYNC_INTERVAL = 10000;

    function reportError(message) {
        if (typeof window.showAppError === 'function') window.showAppError(message);
    }

    function clearError() {
        if (typeof window.hideAppError === 'function') window.hideAppError();
    }

    function withTimeout(promise, ms, label) {
        return new Promise(function (resolve, reject) {
            const timer = setTimeout(function () {
                reject(new Error(label + ' timed out'));
            }, ms);
            Promise.resolve(promise).then(function (value) {
                clearTimeout(timer);
                resolve(value);
            }, function (err) {
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    function storageGet(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function storageSet(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {}
    }

    function storageRemove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {}
    }

    function refreshCacheIfCodeChanged() {
        if (storageGet(VERSION_KEY) !== APP_VERSION) {
            storageRemove(PARTNER_CACHE_KEY);
            storageRemove(ADS_CACHE_KEY);
            storageSet(VERSION_KEY, APP_VERSION);
        }
    }

    function goToRegister() {
        window.location.replace('register.html');
    }

    function readSession() {
        const raw = storageGet(SESSION_KEY);
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            const id = parsed && (parsed.userId || parsed.id);
            if (!id) return null;
            return id;
        } catch (e) {
            return null;
        }
    }

    function parseJsonbValue(raw) {
        if (!raw) return {};
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                return {};
            }
        }
        if (typeof raw === 'object') return raw;
        return {};
    }

    function formatNaira(value) {
        const num = parseFloat(value);
        const safe = isNaN(num) ? 0 : num;
        return '₦' + safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function bootstrap() {
        refreshCacheIfCodeChanged();

        const currentUserId = readSession();
        if (!currentUserId) {
            storageRemove(SESSION_KEY);
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

        let supabase = null;
        let cachedRealBalance = '0.00';
        let isBalanceMasked = false;
        let localNotificationsArray = [];
        let isFirstSync = true;
        let isSyncing = false;
        let toastTimer = null;

        function showToastNotification(text) {
            if (!toastNotificationBox) return;
            toastNotificationBox.textContent = text;
            toastNotificationBox.classList.add('visible');
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(function () {
                toastNotificationBox.classList.remove('visible');
            }, 3000);
        }

        function showLoader() {
            if (!appUniversalLoader) return;
            appUniversalLoader.classList.remove('hidden');
            if (liquidLoaderFill) {
                setTimeout(function () {
                    liquidLoaderFill.style.height = '100%';
                }, 50);
            }
        }

        function hideLoader() {
            if (liquidLoaderFill) liquidLoaderFill.style.height = '0%';
            if (appUniversalLoader) appUniversalLoader.classList.add('hidden');
        }

        function setNoNotifications() {
            if (!alertsItemsContainer) return;
            alertsItemsContainer.innerHTML = '<div style="text-align:center; color:#94a3b8; font-size:13px; padding:20px 0;">No new notifications</div>';
        }

        function triggerAudioNotificationAlert() {
            try {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return;
                const audioCtx = new Ctx();
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

        function pushClientNotificationMessage(text, type) {
            localNotificationsArray.unshift({ text: text, type: type, timestamp: new Date() });
            if (alertCounter) alertCounter.textContent = String(localNotificationsArray.length);

            if (alertsItemsContainer) {
                const first = alertsItemsContainer.firstElementChild;
                if (first && first.classList.contains('alert-entry') === false) {
                    alertsItemsContainer.innerHTML = '';
                }
                const rowNode = document.createElement('div');
                rowNode.className = 'alert-entry ' + type;
                const p = document.createElement('p');
                p.className = 'alert-body-text';
                p.textContent = text;
                rowNode.appendChild(p);
                alertsItemsContainer.insertBefore(rowNode, alertsItemsContainer.firstChild);
            }

            triggerAudioNotificationAlert();
            showToastNotification(text);
        }

        function executeVirtualStringCopy(text) {
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function () {
                        showToastNotification('Account number copied successfully!');
                    }).catch(function () {
                        fallbackCopy(text);
                    });
                } else {
                    fallbackCopy(text);
                }
            } catch (e) {
                fallbackCopy(text);
            }
        }

        function fallbackCopy(text) {
            try {
                const area = document.createElement('textarea');
                area.value = text;
                area.style.position = 'fixed';
                area.style.opacity = '0';
                document.body.appendChild(area);
                area.select();
                document.execCommand('copy');
                document.body.removeChild(area);
                showToastNotification('Account number copied successfully!');
            } catch (e) {}
        }

        function wireInterface() {
            if (openMenuBtn && sidebarMenuDrawer) {
                openMenuBtn.addEventListener('click', function () {
                    sidebarMenuDrawer.classList.add('active');
                });
            }

            if (closeMenuBtn && sidebarMenuDrawer) {
                closeMenuBtn.addEventListener('click', function () {
                    sidebarMenuDrawer.classList.remove('active');
                });
            }

            if (sidebarMenuDrawer) {
                sidebarMenuDrawer.addEventListener('click', function (e) {
                    if (e.target === sidebarMenuDrawer) sidebarMenuDrawer.classList.remove('active');
                });
            }

            if (openAlertsBtn && alertsModalView) {
                openAlertsBtn.addEventListener('click', function () {
                    alertsModalView.classList.add('active');
                    if (localNotificationsArray.length > 0) {
                        localNotificationsArray = [];
                        if (alertCounter) alertCounter.textContent = '0';
                    }
                });
            }

            if (closeAlertsBtn && alertsModalView) {
                closeAlertsBtn.addEventListener('click', function () {
                    alertsModalView.classList.remove('active');
                    setNoNotifications();
                });
            }

            if (triggerHelpModal && helpModalView) {
                triggerHelpModal.addEventListener('click', function (e) {
                    e.preventDefault();
                    helpModalView.classList.add('active');
                });
            }

            if (closeHelpModal && helpModalView) {
                closeHelpModal.addEventListener('click', function () {
                    helpModalView.classList.remove('active');
                });
            }

            document.querySelectorAll('.support-agent-row').forEach(function (row) {
                row.addEventListener('click', function () {
                    const phoneNumber = String(row.getAttribute('data-phone') || '').replace('+', '');
                    const messageBody = row.getAttribute('data-msg') || '';
                    window.open('https://wa.me/' + phoneNumber + '?text=' + encodeURIComponent(messageBody), '_blank');
                });
            });

            if (accountLogoutTrigger) {
                accountLogoutTrigger.addEventListener('click', function (e) {
                    e.preventDefault();
                    storageRemove(SESSION_KEY);
                    goToRegister();
                });
            }

            if (toggleBalanceVisibility && walletBalanceDisplay) {
                toggleBalanceVisibility.addEventListener('click', function () {
                    isBalanceMasked = !isBalanceMasked;
                    if (isBalanceMasked) {
                        walletBalanceDisplay.textContent = '••••';
                        toggleBalanceVisibility.classList.remove('fa-eye');
                        toggleBalanceVisibility.classList.add('fa-eye-slash');
                    } else {
                        walletBalanceDisplay.textContent = formatNaira(cachedRealBalance);
                        toggleBalanceVisibility.classList.remove('fa-eye-slash');
                        toggleBalanceVisibility.classList.add('fa-eye');
                    }
                });
            }
        }

        function readPartnerCache() {
            try {
                return JSON.parse(storageGet(PARTNER_CACHE_KEY) || 'null');
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
                const result = await withTimeout(supabase.from('patner').select('*'), REQUEST_TIMEOUT, 'Partner request');
                if (result.error) throw result.error;

                const data = result.data;

                if (!data || data.length === 0) {
                    storageRemove(PARTNER_CACHE_KEY);
                    renderPartnerButton(null, null);
                    return;
                }

                const row = data[0];
                const bottonData = parseJsonbValue(row.botton);

                const imageUrl = row.imageUrl || bottonData.url || bottonData.imageUrl || '';
                const openLink = row.OpenLink || bottonData.link || bottonData.OpenLink || '';

                const fresh = { imageUrl: imageUrl, openLink: openLink };
                const freshSignature = JSON.stringify(fresh);
                const cachedSignature = cached ? JSON.stringify({ imageUrl: cached.imageUrl, openLink: cached.openLink }) : null;

                if (freshSignature !== cachedSignature) {
                    storageSet(PARTNER_CACHE_KEY, freshSignature);
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
                const result = await withTimeout(supabase.from('ad_image').select('*'), REQUEST_TIMEOUT, 'Ad request');
                if (result.error) throw result.error;

                const ads = result.data;
                if (!ads || ads.length === 0) return;

                let seenAdsIdsArray = [];
                try {
                    seenAdsIdsArray = JSON.parse(storageGet(ADS_CACHE_KEY) || '[]');
                    if (!Array.isArray(seenAdsIdsArray)) seenAdsIdsArray = [];
                } catch (e) {
                    seenAdsIdsArray = [];
                }

                let targetAd = ads.find(function (item) {
                    return !seenAdsIdsArray.includes(item.id);
                });

                if (!targetAd) {
                    seenAdsIdsArray = [];
                    storageSet(ADS_CACHE_KEY, '[]');
                    targetAd = ads[0];
                }

                const adContent = parseJsonbValue(targetAd.ad_image);
                const resolvedUrl = adContent.url || (typeof targetAd.ad_image === 'string' ? targetAd.ad_image : '');

                if (resolvedUrl) {
                    if (adBannerImage.getAttribute('src') !== resolvedUrl) {
                        adBannerImage.src = resolvedUrl;
                    }

                    adBannerWrapper.onclick = function () {
                        if (adContent.link) window.open(adContent.link, '_blank');
                    };

                    if (!seenAdsIdsArray.includes(targetAd.id)) {
                        seenAdsIdsArray.push(targetAd.id);
                        storageSet(ADS_CACHE_KEY, JSON.stringify(seenAdsIdsArray));
                    }
                }
            } catch (e) {}
        }

        function renderVirtualAccounts(accounts) {
            if (!virtualAccountsContainer) return;
            virtualAccountsContainer.innerHTML = '';

            if (Array.isArray(accounts) && accounts.length > 0) {
                accounts.forEach(function (acc) {
                    const tile = document.createElement('div');
                    tile.className = 'account-tile';

                    const meta = document.createElement('div');
                    meta.className = 'account-meta-info';

                    const bank = document.createElement('span');
                    bank.className = 'bank-title-lbl';
                    bank.textContent = acc && acc.bankName ? acc.bankName : '';

                    const num = document.createElement('span');
                    num.className = 'bank-num-string';
                    num.textContent = acc && acc.accountNumber ? acc.accountNumber : '';

                    meta.appendChild(bank);
                    meta.appendChild(num);

                    const icon = document.createElement('i');
                    icon.className = 'fa-regular fa-copy bank-copy-icon';
                    icon.addEventListener('click', function () {
                        executeVirtualStringCopy(String(acc && acc.accountNumber ? acc.accountNumber : ''));
                    });

                    tile.appendChild(meta);
                    tile.appendChild(icon);
                    virtualAccountsContainer.appendChild(tile);
                });
            } else {
                virtualAccountsContainer.innerHTML = '<div style="text-align:center; padding:10px; font-size:12px; color:#64748b; font-weight:500;"><i class="fa-solid fa-triangle-exclamation"></i> Virtual Accounts generating...</div>';
            }
        }

        async function synchronousDashboardStateSync(showLoaderFlag) {
            if (isSyncing) return;
            isSyncing = true;

            if (showLoaderFlag) showLoader();

            try {
                const result = await withTimeout(
                    supabase.from('user_profiles').select('*').eq('id', currentUserId),
                    REQUEST_TIMEOUT,
                    'Profile request'
                );

                if (result.error) throw result.error;

                const profiles = result.data;

                if (!profiles || profiles.length === 0) {
                    storageRemove(SESSION_KEY);
                    goToRegister();
                    return;
                }

                const payloadData = parseJsonbValue(profiles[0].user_data);

                if (userGreetingDisplay && payloadData.full_name) {
                    userGreetingDisplay.textContent = 'Hello, ' + String(payloadData.full_name).split(' ')[0] + ' 👋';
                }

                const incomingRaw = payloadData.user_balance;
                const incomingBalance = (incomingRaw === undefined || incomingRaw === null || incomingRaw === '') ? '0.00' : String(incomingRaw);

                if (incomingBalance !== cachedRealBalance) {
                    const oldBalance = parseFloat(cachedRealBalance) || 0;
                    const newBalance = parseFloat(incomingBalance) || 0;
                    cachedRealBalance = incomingBalance;

                    if (!isBalanceMasked && walletBalanceDisplay) {
                        walletBalanceDisplay.textContent = formatNaira(newBalance);
                    }

                    if (!isFirstSync) {
                        if (oldBalance < newBalance) {
                            const diff = newBalance - oldBalance;
                            pushClientNotificationMessage('AmanData account you get +₦' + diff.toFixed(2) + '. Your main balance: ₦' + newBalance.toFixed(2), 'income');
                        } else if (oldBalance > newBalance) {
                            const diff = oldBalance - newBalance;
                            pushClientNotificationMessage('AmanData account you withdraw -₦' + diff.toFixed(2) + '. Your main balance: ₦' + newBalance.toFixed(2), 'expense');
                        }
                    }
                } else if (!isBalanceMasked && walletBalanceDisplay && isFirstSync) {
                    walletBalanceDisplay.textContent = formatNaira(cachedRealBalance);
                }

                isFirstSync = false;

                renderVirtualAccounts(payloadData.virtual_accounts);

                clearError();

                if (showLoaderFlag) hideLoader();

                await loadMarketingCampaignBanner();
                await loadPartnerButton();
            } catch (err) {
                const message = err && err.message ? err.message : String(err);
                reportError('Could not load your dashboard: ' + message);
            } finally {
                if (showLoaderFlag) hideLoader();
                isSyncing = false;
            }
        }

        async function start() {
            wireInterface();
            setNoNotifications();
            showLoader();

            try {
                const mod = await withTimeout(import('./supabase.js'), REQUEST_TIMEOUT, 'supabase.js');
                supabase = mod && mod.supabase ? mod.supabase : null;
                if (!supabase) throw new Error('supabase client was not exported from supabase.js');
            } catch (err) {
                hideLoader();
                reportError('Could not load supabase.js: ' + (err && err.message ? err.message : String(err)));
                return;
            }

            await synchronousDashboardStateSync(true);

            setInterval(function () {
                synchronousDashboardStateSync(false);
            }, SYNC_INTERVAL);
        }

        start().catch(function (err) {
            hideLoader();
            reportError('Startup error: ' + (err && err.message ? err.message : String(err)));
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
})();
