import { mountShell, showLoader, reveal, toast } from './uix.js';

(function () {
    const PIN = '668360';
    const LENGTH = 6;

    mountShell();
    showLoader();

    const container = document.getElementById('appContainer');
    const row = document.getElementById('pinRow');
    const boxes = [];
    let checking = false;

    function value() {
        return boxes.map((b) => b.value).join('');
    }

    function clearAll() {
        boxes.forEach((b) => { b.value = ''; b.classList.remove('ok', 'bad'); });
        boxes[0].focus();
    }

    function verify() {
        if (checking) return;
        checking = true;
        if (value() === PIN) {
            boxes.forEach((b) => b.classList.add('ok'));
            try { sessionStorage.setItem('gate_ok', '1'); } catch (err) {}
            toast('Access granted.', 'ok');
            setTimeout(() => window.location.replace('admin.html'), 700);
            return;
        }
        boxes.forEach((b) => { b.classList.remove('ok'); b.classList.add('bad'); });
        toast('Wrong PIN. Try again.', 'err');
        setTimeout(() => { clearAll(); checking = false; }, 600);
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