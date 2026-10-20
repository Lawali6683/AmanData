import { mountShell, showLoader, reveal, toast } from './uix.js';

(function () {
    const LENGTH = 6;
    const SALT = 'amandata.gate.v1';
    const ROUNDS = 310000;
    const EXPECTED = '07dd17590722c908efc812800d7be5cac1ac5f0296a4371abacd9a4ddfde2338';
    const MAX_TRIES = 5;
    const LOCK_MS = 60000;
    const TRIES_KEY = 'gate_tries';
    const LOCK_KEY = 'gate_lock_until';

    mountShell();
    showLoader();

    const container = document.getElementById('appContainer');
    const row = document.getElementById('pinRow');
    const boxes = [];
    let checking = false;

    function readNumber(key) {
        try { return Number(sessionStorage.getItem(key)) || 0; } catch (err) { return 0; }
    }

    function writeNumber(key, value) {
        try { sessionStorage.setItem(key, String(value)); } catch (err) {}
    }

    function value() {
        return boxes.map((b) => b.value).join('');
    }

    function clearAll() {
        boxes.forEach((b) => { b.value = ''; b.classList.remove('ok', 'bad'); });
        boxes[0].focus();
    }

    async function derive(pin) {
        const subtle = window.crypto && window.crypto.subtle;
        if (!subtle) return null;
        const encoder = new TextEncoder();
        const key = await subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
        const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(SALT), iterations: ROUNDS }, key, 256);
        return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    function same(a, b) {
        if (!a || a.length !== b.length) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        return diff === 0;
    }

    function reject(message) {
        boxes.forEach((b) => { b.classList.remove('ok'); b.classList.add('bad'); });
        toast(message, 'err');
        setTimeout(() => { clearAll(); checking = false; }, 600);
    }

    async function verify() {
        if (checking) return;
        checking = true;

        const wait = readNumber(LOCK_KEY) - Date.now();
        if (wait > 0) {
            reject('Too many wrong attempts. Wait ' + Math.ceil(wait / 1000) + ' seconds.');
            return;
        }

        let code = null;
        try { code = await derive(value()); } catch (err) { code = null; }

        if (code === null) {
            reject('This browser cannot check the PIN. Open the page over a secure (https) connection.');
            return;
        }

        if (same(code, EXPECTED)) {
            writeNumber(TRIES_KEY, 0);
            boxes.forEach((b) => b.classList.add('ok'));
            try { sessionStorage.setItem('gate_ok', '1'); } catch (err) {}
            toast('Access granted.', 'ok');
            setTimeout(() => window.location.replace('admin.html'), 700);
            return;
        }

        const tries = readNumber(TRIES_KEY) + 1;
        if (tries >= MAX_TRIES) {
            writeNumber(TRIES_KEY, 0);
            writeNumber(LOCK_KEY, Date.now() + LOCK_MS);
            reject('Too many wrong attempts. Try again in ' + (LOCK_MS / 1000) + ' seconds.');
            return;
        }
        writeNumber(TRIES_KEY, tries);
        reject('Wrong PIN. Try again.');
    }

    function fill(start, digits) {
        let i = start;
        for (const ch of digits) {
            if (i >= LENGTH) break;
            boxes[i].value = ch;
            boxes[i].classList.add('ok');
            i++;
        }
        if (i < LENGTH) boxes[i].focus();
        else boxes[LENGTH - 1].focus();
        if (value().length === LENGTH) verify();
    }

    for (let i = 0; i < LENGTH; i++) {
        const b = document.createElement('input');
        b.type = 'password';
        b.inputMode = 'numeric';
        b.autocomplete = 'one-time-code';
        b.maxLength = 1;
        b.className = 'pin-box';
        b.setAttribute('aria-label', 'PIN digit ' + (i + 1));
        row.appendChild(b);
        boxes.push(b);

        b.addEventListener('input', () => {
            if (checking) { b.value = ''; return; }
            const digits = b.value.replace(/\D/g, '');
            b.value = '';
            b.classList.remove('ok');
            if (digits) fill(i, digits);
        });
        b.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !b.value && i > 0) {
                boxes[i - 1].value = '';
                boxes[i - 1].classList.remove('ok');
                boxes[i - 1].focus();
            }
        });
        b.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
            if (text && !checking) fill(i, text);
        });
    }

    reveal(container, 900);
    setTimeout(() => boxes[0].focus(), 2200);
})();
