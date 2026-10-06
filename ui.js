export const LOGO = 'https://i.imgur.com/bNK9ccG.png';
export const SESSION_KEY = 'puredata_user_session';

const WAVE = '<svg viewBox="0 0 1200 80" preserveAspectRatio="none"><path d="M0,40 C200,80 400,0 600,40 C800,80 1000,0 1200,40 L1200,80 L0,80 Z"></path></svg>';
let el = {};
let fillTimer = null;
let toastTimer = null;

export function sessionId() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        const s = raw ? JSON.parse(raw) : null;
        const id = s ? (s.userId || s.id || (s.user && s.user.id)) : null;
        return id ? String(id) : null;
    } catch (err) {
        return null;
8    }
}

export function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function money(value) {
    const n = parseFloat(String(value === undefined || value === null ? 0 : value).replace(/,/g, ''));
    return (isFinite(n) ? n : 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function mountShell() {
    document.body.insertAdjacentHTML('afterbegin',
        '<div class="scene" id="scene"><div class="bg" id="bg"></div>' +
        '<img src="' + LOGO + '" class="loader-logo" id="loaderLogo" alt="Logo">' +
        '<div class="liquid" id="liquid"><div class="wave wave-1">' + WAVE + '</div><div class="wave wave-2">' + WAVE + '</div></div></div>' +
        '<div class="brand" id="brand">Loading<span class="bdot">.</span><span class="bdot">.</span><span class="bdot">.</span></div>' +
        '<div class="toast-container" id="toastContainer"><span class="toast-icon" id="toastIcon"></span><span class="toast-message" id="toastMessage"></span></div>');
    el = {
        scene: document.getElementById('scene'),
        bg: document.getElementById('bg'),
        liquid: document.getElementById('liquid'),
        brand: document.getElementById('brand'),
        logo: document.getElementById('loaderLogo'),
        toast: document.getElementById('toastContainer'),
        toastIcon: document.getElementById('toastIcon'),
        toastMessage: document.getElementById('toastMessage')
    };
    el.toast.addEventListener('click', () => el.toast.classList.remove('active'));
}

export function showLoader() {
    clearTimeout(fillTimer);
    el.liquid.style.transition = 'none';
    el.liquid.style.height = '0%';
    void el.liquid.offsetHeight;
    el.liquid.style.transition = 'height 1.6s cubic-bezier(0.4, 0, 0.2, 1)';
    el.bg.classList.remove('show');
    el.brand.classList.remove('hide');
    el.logo.classList.remove('hide');
    el.scene.classList.remove('hidden');
    fillTimer = setTimeout(() => { el.liquid.style.height = '100%'; }, 300);
}

export function hideLoader(onDone) {
    clearTimeout(fillTimer);
    el.liquid.style.transition = 'height 1.8s cubic-bezier(0.4, 0, 0.2, 1)';
    el.liquid.style.height = '0%';
    el.brand.classList.add('hide');
    el.logo.classList.add('hide');
    el.bg.classList.add('show');
    setTimeout(() => {
        el.scene.classList.add('hidden');
        if (onDone) onDone();
    }, 600);
}

export function toast(message, type) {
    const ok = type === 'ok';
    el.toast.classList.remove('ok', 'err');
    el.toast.classList.add(ok ? 'ok' : 'err');
    el.toastIcon.textContent = ok ? '✅' : '❌';
    el.toastMessage.textContent = message;
    el.toast.classList.add('active');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('active'), 4500);
}

export function pinBoxes(root) {
    root.innerHTML = '';
    const boxes = [];
    for (let i = 0; i < 4; i++) {
        const b = document.createElement('input');
        b.type = 'password';
        b.inputMode = 'numeric';
        b.maxLength = 1;
        b.autocomplete = 'off';
        b.className = 'pin-box';
        root.appendChild(b);
        boxes.push(b);
        b.addEventListener('input', () => {
            const ch = b.value.slice(-1);
            if (/^[0-9]$/.test(ch)) {
                b.value = ch;
                b.classList.remove('bad');
                b.classList.add('ok');
                if (i < 3) boxes[i + 1].focus();
            } else {
                b.value = '';
                b.classList.remove('ok');
                b.classList.add('bad');
                setTimeout(() => b.classList.remove('bad'), 500);
            }
        });
        b.addEventListener('keydown', (e) => {
            if (e.key !== 'Backspace') return;
            b.classList.remove('ok');
            if (!b.value && i > 0) {
                boxes[i - 1].value = '';
                boxes[i - 1].classList.remove('ok');
                boxes[i - 1].focus();
            }
        });
    }
    const read = () => boxes.map((b) => b.value).join('');
    return {
        value: read,
        valid: () => /^\d{4}$/.test(read()),
        clear: () => { boxes.forEach((b) => { b.value = ''; b.classList.remove('ok', 'bad'); }); boxes[0].focus(); }
    };
}

export const LOGOS = {
    dstv: 'https://i.imgur.com/XBe4eRi.png',
    gotv: 'https://i.imgur.com/eaTdFAU.png',
    startimes: 'https://i.imgur.com/3DbujW2.png',
    glo: 'https://i.imgur.com/JlSw9vx.png',
    '9mobile': 'https://i.imgur.com/EM2g22Z.png',
    airtel: 'https://i.imgur.com/aMgSbKX.png',
    mtn: 'https://i.imgur.com/U82jQBd.png',
    waec: 'https://i.imgur.com/jZXQymK.png',
    jamb: 'https://i.imgur.com/sVgzPfV.png',
    neco: 'https://i.imgur.com/YHwxsGM.png',
    nabteb: 'https://i.imgur.com/MU3qSXl.png'
};