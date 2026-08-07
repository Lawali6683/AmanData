import { supabase } from './supabase.js';

(function() {

    const API_ENDPOINT = "/api/withdraw";

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

    const appUniversalLoader = document.getElementById('loadingScene');
    const liquidLoaderFill = document.getElementById('liquid');
    const brandText = document.getElementById('brand');
    const backgroundView = document.getElementById('bg');
    const walletBalanceDisplay = document.getElementById('user_balance');
    const amountInput = document.getElementById('amount');
    const bankCodeSelect = document.getElementById('bank_code');
    const accountNumberInput = document.getElementById('account_number');
    const accountNameInput = document.getElementById('account_name');
    const nameGroupField = document.getElementById('nameGroup');
    const verificationLoader = document.getElementById('verificationLoader');
    const feeCalculationDisplay = document.getElementById('fee_calc');
    const submitTransactionBtn = document.getElementById('submitBtn');
    const toastNotificationBox = document.getElementById('toastContainer');

    let cachedRealBalance = 0;
    let userSecurePin = "";

    function showToastNotification(text, type = 'error') {
        if (!toastNotificationBox) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-xmark' : 'fa-circle-check'}" style="color:${type === 'error' ? '#ef4444' : '#22c55e'}"></i> <span>${text}</span>`;
        toastNotificationBox.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 50);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    async function initializeWithdrawalPage() {
        if (liquidLoaderFill) liquidLoaderFill.classList.add('fill');
        await fetchUserSessionAndData();
        if (liquidLoaderFill && brandText && backgroundView) {
            liquidLoaderFill.style.transition = 'height 1.8s cubic-bezier(0.4, 0, 0.2, 1)';
            liquidLoaderFill.style.height = '0%';
            brandText.classList.add('hide');
            backgroundView.classList.add('show');
        }
        setTimeout(() => {
            if (appUniversalLoader) appUniversalLoader.style.display = 'none';
            if (brandText) brandText.style.display = 'none';
        }, 1800);
    }

    async function fetchUserSessionAndData() {
        try {
            const { data: profiles, error: dbError } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('id', currentUserId);

            if (dbError) {
                console.error(dbError.message);
                showToastNotification(`Database Error: ${dbError.message}`);
                return;
            }

            if (!profiles || profiles.length === 0) {
                localStorage.removeItem('puredata_user_session');
                window.location.replace('register.html');
                return;
            }

            const payloadData = profiles[0].user_data;
            if (payloadData) {
                cachedRealBalance = parseFloat(payloadData.user_balance || 0);
                userSecurePin = String(payloadData.pin || "");
                if (walletBalanceDisplay) {
                    walletBalanceDisplay.innerText = cachedRealBalance.toFixed(2);
                }
            } else {
                showToastNotification("Data Error: User profile configuration is empty.");
            }
        } catch (err) {
            console.error(err);
            showToastNotification(`System Error: ${err.message || err}`);
        }
    }

    if (amountInput) {
        amountInput.addEventListener('input', () => {
            const amt = parseFloat(amountInput.value) || 0;
            if (amt > cachedRealBalance) {
                showToastNotification("Insolvent Funds: Input amount exceeds current wallet balance.");
                if (submitTransactionBtn) submitTransactionBtn.style.display = 'none';
                return;
            }
            const gasFee = amt * 0.03;
            const settlementAmount = amt - gasFee;
            if (feeCalculationDisplay) {
                feeCalculationDisplay.innerText = `You will receive: ₦${settlementAmount.toFixed(2)} (Gas Fee: ₦${gasFee.toFixed(2)})`;
            }
            checkFormValidity();
        });
    }

    if (bankCodeSelect) bankCodeSelect.addEventListener('change', triggerAccountVerification);
    if (accountNumberInput) accountNumberInput.addEventListener('input', triggerAccountVerification);

    function triggerAccountVerification() {
        const bCode = bankCodeSelect ? bankCodeSelect.value : "";
        const accNum = accountNumberInput ? accountNumberInput.value : "";

        if (bCode && accNum.length === 10) {
            if (verificationLoader) verificationLoader.style.display = 'block';
            if (nameGroupField) nameGroupField.style.display = 'none';
            if (accountNameInput) accountNameInput.value = "";

            fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'verify_account', bank_code: bCode, account_number: accNum, req_pass: '@haruna66' })
            })
            .then(res => {
                if(!res.ok) throw new Error("Verification Endpoint Error");
                return res.json();
            })
            .then(data => {
                if (verificationLoader) verificationLoader.style.display = 'none';
                if (data.success) {
                    if (nameGroupField) nameGroupField.style.display = 'block';
                    if (accountNameInput) accountNameInput.value = data.account_name;
                    checkFormValidity();
                } else {
                    showToastNotification(data.message || "Unable to resolve account identity.");
                }
            }).catch(() => {
                if (verificationLoader) verificationLoader.style.display = 'none';
                showToastNotification("Network failure during verification.");
            });
        }
    }

    const pinInputsArray = ['p1', 'p2', 'p3', 'p4'];
    pinInputsArray.forEach((id, index) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            if (el.value.length === 1 && index < 3) {
                const nextEl = document.getElementById(pinInputsArray[index + 1]);
                if (nextEl) nextEl.focus();
            }
            verifyPinPattern();
        });

        el.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && el.value === '' && index > 0) {
                const prevEl = document.getElementById(pinInputsArray[index - 1]);
                if (prevEl) prevEl.focus();
            }
        });
    });

    function verifyPinPattern() {
        let compiledPin = "";
        for (let i = 1; i <= 4; i++) {
            const box = document.getElementById('p' + i);
            const status = document.getElementById('s' + i);
            if (!box || !status) continue;
            compiledPin += box.value;
            if (box.value !== "") {
                if (box.value === userSecurePin[i - 1]) {
                    status.className = "status-icon valid";
                    status.innerHTML = "✔";
                } else {
                    status.className = "status-icon invalid";
                    status.innerHTML = "✖";
                }
            } else {
                status.className = "status-icon";
                status.innerHTML = "";
            }
        }

        if (compiledPin.length === 4) {
            checkFormValidity();
        }
    }

    function checkFormValidity() {
        if (!amountInput || !accountNameInput || !submitTransactionBtn) return;

        const amt = parseFloat(amountInput.value) || 0;
        const name = accountNameInput.value;

        let compiledPin = "";
        for (let i = 1; i <= 4; i++) {
            const box = document.getElementById('p' + i);
            if (box) compiledPin += box.value;
        }

        if (amt > 0 && amt <= cachedRealBalance && name !== "" && compiledPin === userSecurePin) {
            submitTransactionBtn.style.display = 'block';
        } else {
            submitTransactionBtn.style.display = 'none';
        }
    }

    if (submitTransactionBtn) {
        submitTransactionBtn.addEventListener('click', () => {
            if (appUniversalLoader) appUniversalLoader.style.display = 'block';
            const loaderLogo = document.getElementById('loaderLogo');
            if (loaderLogo) loaderLogo.style.display = 'block';

            if (brandText) {
                brandText.style.display = 'block';
                brandText.classList.remove('hide');
                brandText.innerHTML = 'Processing<span class="bdot">.</span><span class="bdot">.</span><span class="bdot">.</span>';
            }
            if (liquidLoaderFill) liquidLoaderFill.style.height = '100%';

            let compiledPin = "";
            for (let i = 1; i <= 4; i++) {
                const box = document.getElementById('p' + i);
                if (box) compiledPin += box.value;
            }

            const payload = {
                action: 'payout',
                uuid: currentUserId,
                pin: compiledPin,
                req_pass: '@haruna66',
                amount: parseFloat(amountInput.value),
                bank_code: bankCodeSelect.value,
                bank_name: bankCodeSelect.options[bankCodeSelect.selectedIndex].text,
                account_number: accountNumberInput.value
            };

            fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(res => res.json())
            .then(data => {
                if (liquidLoaderFill) {
                    liquidLoaderFill.style.transition = 'height 1.8s cubic-bezier(0.4, 0, 0.2, 1)';
                    liquidLoaderFill.style.height = '0%';
                }
                if (brandText) brandText.classList.add('hide');

                setTimeout(() => {
                    if (appUniversalLoader) appUniversalLoader.style.display = 'none';
                    if (brandText) brandText.style.display = 'none';

                    if (data.success) {
                        showToastNotification("Transaction Successful! Funds dispatched.", 'success');
                        cachedRealBalance -= payload.amount;
                        if (walletBalanceDisplay) walletBalanceDisplay.innerText = cachedRealBalance.toFixed(2);

                        amountInput.value = "";
                        accountNumberInput.value = "";
                        accountNameInput.value = "";
                        if (nameGroupField) nameGroupField.style.display = 'none';

                        pinInputsArray.forEach(id => {
                            const box = document.getElementById(id);
                            if (box) box.value = "";
                        });
                        for (let i = 1; i <= 4; i++) {
                            const status = document.getElementById('s' + i);
                            if (status) {
                                status.className = "status-icon";
                                status.innerHTML = "";
                            }
                        }
                        submitTransactionBtn.style.display = 'none';
                    } else {
                        showToastNotification(data.message || "Please try again later.");
                    }
                }, 1800);
            }).catch((err) => {
                if (liquidLoaderFill) {
                    liquidLoaderFill.style.transition = 'height 1.8s cubic-bezier(0.4, 0, 0.2, 1)';
                    liquidLoaderFill.style.height = '0%';
                }
                if (brandText) brandText.classList.add('hide');

                setTimeout(() => {
                    if (appUniversalLoader) appUniversalLoader.style.display = 'none';
                    if (brandText) brandText.style.display = 'none';
                    showToastNotification(`API Payout Error: ${err.message || "Please try again later."}`);
                }, 1800);
            });
        });
    }

    
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initializeWithdrawalPage);
    } else {
        initializeWithdrawalPage();
    }

})();
