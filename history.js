trueimport { supabase } from './supabase.js';

(function() {
    const scene = document.getElementById('scene');
    const liquid = document.getElementById('liquid');
    const brand = document.getElementById('brand');
    const loaderLogo = document.getElementById('loaderLogo');
    const bg = document.getElementById('bg');
    const appContainer = document.getElementById('appContainer');
    const historyList = document.getElementById('historyList');
    const tabAll = document.getElementById('tabAll');
    const tabIn = document.getElementById('tabIn');
    const tabOut = document.getElementById('tabOut');
    const detailsOverlay = document.getElementById('detailsOverlay');
    const btnCloseDetails = document.getElementById('btnCloseDetails');
    const detType = document.getElementById('detType');
    const detAmount = document.getElementById('detAmount');
    const detRef = document.getElementById('detRef');
    const detDate = document.getElementById('detDate');
    const detTime = document.getElementById('detTime');
    const toastContainer = document.getElementById('toastContainer');
    const toastMessage = document.getElementById('toastMessage');
    
    const sessionTokenString = localStorage.getItem('puredata_user_session');
    let rawTransactions = [];
    let activeFilter = 'all';

    setTimeout(() => {
        if (liquid) liquid.classList.add('fill');
    }, 400);

    function showToast(message) {
        if (!toastMessage || !toastContainer) return;
        toastMessage.textContent = message;
        toastContainer.classList.add('active');
        setTimeout(() => {
            toastContainer.classList.remove('active');
        }, 3000);
    }

    function hideLoader() {
        if (liquid) {
            liquid.style.transition = 'height 1.8s cubic-bezier(0.4, 0, 0.2, 1)';
            liquid.style.height = '0%';
        }
        if (brand) brand.classList.add('hide');
        if (loaderLogo) loaderLogo.classList.add('hide');
        if (bg) bg.classList.add('show');

        setTimeout(() => {
            if (scene) scene.classList.add('hidden');
            if (appContainer) appContainer.classList.add('ready');
        }, 600);
    }

    async function fetchTransactionHistory() {
        if (!sessionTokenString) {
            window.location.replace('register.html');
            return;
        }

        try {
            const activeSession = JSON.parse(sessionTokenString);
            const userUUID = activeSession.user?.id || activeSession.id;

            if (!userUUID) {
                window.location.replace('register.html');
                return;
            }

            const { data, error } = await supabase
                .from('transactions')
                .select('*')
                .eq('user_id', userUUID)
                .order('created_at', { ascending: false });

            if (error) throw error;
            rawTransactions = data || [];
            renderTransactions();
        } catch (err) {
            showToast("Failed to fetch historical transaction updates.");
            renderEmptyState();
        } finally {
            setTimeout(hideLoader, 2200);
        }
    }

    function renderEmptyState() {
        if (!historyList) return;
        historyList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-receipt empty-icon"></i>
                <h3 class="empty-title">No Transactions Found</h3>
                <p class="empty-desc">You have not completed any payments or deposits yet. All processed histories will map directly here.</p>
            </div>
        `;
    }

    function renderTransactions() {
        if (!historyList) return;
        historyList.innerHTML = "";

        const filtered = rawTransactions.filter(tx => {
            if (activeFilter === 'in') return tx.type === 'deposit';
            if (activeFilter === 'out') return tx.type !== 'deposit';
            return true;
        });

        if (filtered.length === 0) {
            renderEmptyState();
            return;
        }

        filtered.forEach(tx => {
            const card = document.createElement('div');
            card.className = "transaction-card";

            const isDeposit = tx.type === 'deposit';
            const iconClass = isDeposit ? 'fa-solid fa-wallet' : 'fa-solid fa-mobile-screen-button';
            const iconFrameClass = isDeposit ? 'deposit' : 'spending';
            const amountClass = isDeposit ? 'deposit' : 'spending';
            const amountPrefix = isDeposit ? '+' : '-';

            const dateObj = new Date(tx.created_at);
            const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

            card.innerHTML = `
                <div class="tx-left">
                    <div class="tx-icon-frame ${iconFrameClass}">
                        <i class="${iconClass}"></i>
                    </div>
                    <div class="tx-meta">
                        <span class="tx-title">${tx.type.toUpperCase()}</span>
                        <span class="tx-date">${dateStr}</span>
                    </div>
                </div>
                <div class="tx-right">
                    <span class="tx-amount ${amountClass}">${amountPrefix}₦${parseFloat(tx.amount).toFixed(2)}</span>
                    <span class="tx-status" style="color: var(--success)">Success</span>
                </div>
            `;
            
            card.addEventListener('click', () => openDetailsOverlay(tx));
            historyList.appendChild(card);
        });
    }

    function openDetailsOverlay(tx) {
        if (!detailsOverlay) return;
        const dateObj = new Date(tx.created_at);
        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        if (detType) detType.textContent = tx.type.toUpperCase();
        if (detAmount) detAmount.textContent = `₦${parseFloat(tx.amount).toFixed(2)}`;
        if (detRef) detRef.textContent = tx.reference || "N/A";
        if (detDate) detDate.textContent = dateStr;
        if (detTime) detTime.textContent = timeStr;

        detailsOverlay.classList.add('active');
    }

    if (btnCloseDetails && detailsOverlay) {
        btnCloseDetails.addEventListener('click', () => {
            detailsOverlay.classList.remove('active');
        });
    }

    function switchTab(newFilter, activeBtn, inactiveBtn1, inactiveBtn2) {
        activeFilter = newFilter;
        if (activeBtn) activeBtn.classList.add('active');
        if (inactiveBtn1) inactiveBtn1.classList.remove('active');
        if (inactiveBtn2) inactiveBtn2.classList.remove('active');
        renderTransactions();
    }

    if (tabAll) tabAll.addEventListener('click', () => switchTab('all', tabAll, tabIn, tabOut));
    if (tabIn) tabIn.addEventListener('click', () => switchTab('in', tabIn, tabAll, tabOut));
    if (tabOut) tabOut.addEventListener('click', () => switchTab('out', tabOut, tabAll, tabIn));

    window.addEventListener('DOMContentLoaded', fetchTransactionHistory);
})();
