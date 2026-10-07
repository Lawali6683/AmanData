import { mountShell, showLoader, reveal } from './uix.js';
import { getSession, mountLogin, signOut } from './auth.js';

(function () {
    let unlocked = false;
    try { unlocked = sessionStorage.getItem('gate_ok') === '1'; } catch (err) {}
    if (!unlocked) {
        window.location.replace('gate.html');
        return;
    }

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    const loginCard = $('loginCard');
    const menu = $('menu');

    function showMenu(session) {
        loginCard.classList.add('hidden');
        menu.classList.remove('hidden');
        $('adminEmail').textContent = session.user.email;
    }

    function showLogin() {
        menu.classList.add('hidden');
        loginCard.classList.remove('hidden');
        mountLogin(loginCard, showMenu);
    }

    async function initialize() {
        try {
            const session = await getSession();
            if (session) showMenu(session);
            else showLogin();
        } catch (err) {
            showLogin();
        } finally {
            reveal(container, 1200);
        }
    }

    $('btnBack').addEventListener('click', () => { window.location.href = 'gate.html'; });
    $('btnLogout').addEventListener('click', async () => {
        await signOut();
        showLogin();
    });

    initialize();
})();