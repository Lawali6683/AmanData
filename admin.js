import { mountShell, showLoader, reveal } from './uix.js';

(function () {
    let unlocked = false;
    try { unlocked = sessionStorage.getItem('gate_ok') === '1'; } catch (err) {}
    if (!unlocked) {
        window.location.replace('gate.html');
        return;
    }

    mountShell();
    showLoader();

    document.getElementById('btnBack').addEventListener('click', () => { window.location.href = 'gate.html'; });
    reveal(document.getElementById('appContainer'), 1000);
})();
