import { supabase } from './supabase.js';
import { mountShell, showLoader, hideLoader, toast } from './uix.js';

(function () {
    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const appContainer = $('appContainer');
    const emailInput = $('email');
    const passInput = $('password');
    const loginBtn = $('btnLogin');
    let busy = false;

    function showMenu(email) {
        $('loginCard').classList.add('hidden');
        $('menu').classList.remove('hidden');
        $('adminEmail').textContent = email;
    }

    function showLogin() {
        $('menu').classList.add('hidden');
        $('loginCard').classList.remove('hidden');
    }

    function checkForm() {
        loginBtn.hidden = !(/^\S+@\S+\.\S+$/.test(emailInput.value.trim()) && passInput.value.length > 0);
    }

    async function login() {
        if (busy) return;
        busy = true;
        showLoader();
        let result = null;
        try {
            result = await supabase.auth.signInWithPassword({ email: emailInput.value.trim(), password: passInput.value });
        } catch (err) {
            result = { error: err };
        }
        hideLoader();
        busy = false;
        if (!result || result.error || !result.data || !result.data.session) {
            toast('Incorrect email or password. Please try again.', 'err');
            return;
        }
        passInput.value = '';
        checkForm();
        showMenu(result.data.session.user.email);
    }

    async function logout() {
        showLoader();
        try { await supabase.auth.signOut(); } catch (err) {}
        hideLoader(showLogin);
    }

    async function initialize() {
        try {
            const { data } = await supabase.auth.getSession();
            if (data && data.session) showMenu(data.session.user.email);
            else showLogin();
        } catch (err) {
            showLogin();
        } finally {
            setTimeout(() => hideLoader(() => appContainer.classList.add('ready')), 1600);
        }
    }

    $('btnBack').addEventListener('click', () => { if (window.history.length > 1) window.history.back(); else window.location.href = 'dashboard.html'; });
    $('btnEye').addEventListener('click', () => {
        const show = passInput.type === 'password';
        passInput.type = show ? 'text' : 'password';
        $('btnEye').innerHTML = '<i class="fa-solid ' + (show ? 'fa-eye-slash' : 'fa-eye') + '"></i>';
    });
    emailInput.addEventListener('input', checkForm);
    passInput.addEventListener('input', checkForm);
    passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !loginBtn.hidden) login(); });
    loginBtn.addEventListener('click', login);
    $('btnLogout').addEventListener('click', logout);

    initialize();
})();
