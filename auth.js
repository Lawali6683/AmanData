import { supabase } from './supabase.js';
import { toast } from './uix.js';

export const LOGIN_PAGE = 'admin.html';

export async function getSession() {
    try {
        const { data } = await supabase.auth.getSession();
        return data && data.session ? data.session : null;
    } catch (err) {
        return null;
    }
}

export async function accessToken() {
    const session = await getSession();
    return session ? session.access_token : null;
}

export async function signIn(email, password) {
    let result;
    try {
        result = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: password });
    } catch (err) {
        return { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
    }
    if (result.error || !result.data || !result.data.session) {
        const message = result.error && result.error.message === 'Invalid login credentials'
            ? 'The email or password is incorrect.'
            : 'Sign in failed. Please try again.';
        return { ok: false, message: message };
    }
    return { ok: true, session: result.data.session };
}

export async function signOut() {
    try { await supabase.auth.signOut(); } catch (err) {}
}

export async function requireSession() {
    const session = await getSession();
    if (session) return session;
    window.location.replace(LOGIN_PAGE);
    return null;
}

export function mountLogin(root, onSuccess) {
    root.innerHTML =
        '<h3 class="form-title">Sign in</h3>' +
        '<p class="form-desc">Sign in with your email and password.</p>' +
        '<form id="loginForm" class="form-card" style="padding:0;border:0;background:none" novalidate>' +
        '<div class="field"><label for="loginEmail">Email</label>' +
        '<input class="input" id="loginEmail" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="name@example.com"></div>' +
        '<div class="field"><label for="loginPassword">Password</label><div class="input-wrap">' +
        '<input class="input" id="loginPassword" type="password" autocomplete="current-password" placeholder="Password">' +
        '<button type="button" class="eye-btn" id="loginEye" aria-label="Show password"><i class="fa-solid fa-eye"></i></button></div></div>' +
        '<button type="submit" class="btn-primary" id="loginBtn">Sign in</button></form>';

    const form = root.querySelector('#loginForm');
    const email = root.querySelector('#loginEmail');
    const password = root.querySelector('#loginPassword');
    const button = root.querySelector('#loginBtn');
    const eye = root.querySelector('#loginEye');
    let busy = false;

    eye.addEventListener('click', () => {
        const show = password.type === 'password';
        password.type = show ? 'text' : 'password';
        eye.innerHTML = '<i class="fa-solid ' + (show ? 'fa-eye-slash' : 'fa-eye') + '"></i>';
        eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) {
            toast('Enter a valid email address.', 'err');
            email.focus();
            return;
        }
        if (!password.value) {
            toast('Enter your password.', 'err');
            password.focus();
            return;
        }
        busy = true;
        button.disabled = true;
        button.textContent = 'Signing in...';
        const result = await signIn(email.value, password.value);
        busy = false;
        button.disabled = false;
        button.textContent = 'Sign in';
        if (!result.ok) {
            toast(result.message, 'err');
            return;
        }
        password.value = '';
        toast('Signed in successfully.', 'ok');
        onSuccess(result.session);
    });
}