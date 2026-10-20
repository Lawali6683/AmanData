import { supabase } from './client.js';
import { LOGO, showLoader, hideLoader, toast } from './uix.js';

export const LOGIN_PAGE = 'admin.html';

const SALT = 'amandata.admin.v1:';
const ALLOWED = [
    '05de40b3f479234c3634b8816708ec0fcf9415cc78912e3982134879ec663df6',
    '2c7155195ede75f2540ed2068c0292329f178918a406d3d67eebba64052480e5',
    '30eb92690d4adc566024cc4907708d84747696efffde3ac12f3a45cc5a748624',
    'bdac7f63e2697a92ff989ccd0a21707431a2510d924dae88da7e3cbcaf80cc10'
];
const DENIED_MESSAGE = 'This email is not allowed to sign in here.';
const UNSUPPORTED_MESSAGE = 'This browser cannot verify the sign in. Open the page over a secure (https) connection.';

async function fingerprint(email) {
    const subtle = window.crypto && window.crypto.subtle;
    if (!subtle) return null;
    const bytes = new TextEncoder().encode(SALT + String(email || '').trim().toLowerCase());
    const buffer = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function isAllowedEmail(email) {
    const code = await fingerprint(email);
    return code !== null && ALLOWED.indexOf(code) !== -1;
}

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

export async function signOut() {
    try { await supabase.auth.signOut(); } catch (err) {}
}

export async function signIn(email, password, options) {
    const open = Boolean(options && options.anyUser);

    if (!open) {
        const code = await fingerprint(email);
        if (code === null) return { ok: false, message: UNSUPPORTED_MESSAGE };
        if (ALLOWED.indexOf(code) === -1) return { ok: false, message: DENIED_MESSAGE };
    }

    let result;
    try {
        result = await supabase.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password: password });
    } catch (err) {
        return { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
    }
    if (result.error || !result.data || !result.data.session) {
        const message = result.error && result.error.message === 'Invalid login credentials'
            ? 'The email or password is incorrect.'
            : 'Sign in failed. Please try again.';
        return { ok: false, message: message };
    }

    const session = result.data.session;
    if (!open && !(await isAllowedEmail(session.user && session.user.email))) {
        await signOut();
        return { ok: false, message: DENIED_MESSAGE };
    }
    return { ok: true, session: session };
}

export function requireSession(options) {
    const open = Boolean(options && options.anyUser);
    return new Promise(async (resolve) => {
        const existing = await getSession();
        if (existing) {
            if (open || (await isAllowedEmail(existing.user && existing.user.email))) {
                resolve(existing);
                return;
            }
            await signOut();
        }
        hideLoader();
        const overlay = document.createElement('div');
        overlay.className = 'login-overlay';
        overlay.innerHTML =
            '<div class="login-box"><img src="' + LOGO + '" class="page-logo" alt="Logo">' +
            '<section class="form-card" id="authCard"></section>' +
            '<button type="button" class="link-btn" id="authBack">Back to menu</button></div>';
        document.body.appendChild(overlay);
        overlay.querySelector('#authBack').addEventListener('click', () => { window.location.replace(LOGIN_PAGE); });
        mountLogin(overlay.querySelector('#authCard'), (session) => {
            overlay.remove();
            showLoader();
            resolve(session);
        }, options);
    });
}

export function mountLogin(root, onSuccess, options) {
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
        const result = await signIn(email.value, password.value, options);
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
