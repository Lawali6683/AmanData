import { mountShell, showLoader, reveal, toast } from './uix.js';
import { requireSession } from './auth.js';

(function () {
    const TARGET = 'https://app.bilalsadasub.com/dashboard/app';

    mountShell();
    showLoader();

    const container = document.getElementById('appContainer');
    const frame = document.getElementById('frame');
    let revealed = false;
    let slowTimer = null;

    function done() {
        if (revealed) return;
        revealed = true;
        clearTimeout(slowTimer);
        reveal(container, 600);
    }

    function load() {
        revealed = false;
        clearTimeout(slowTimer);
        frame.src = TARGET;
        slowTimer = setTimeout(() => {
            if (revealed) return;
            done();
            toast('The page is taking long to load. Check your connection or reload.', 'err');
        }, 15000);
    }

    frame.addEventListener('load', done);

    document.getElementById('btnBack').addEventListener('click', () => {
        if (window.history.length > 1) window.history.back();
        else window.location.href = 'admin.html';
    });
    document.getElementById('btnRefresh').addEventListener('click', () => {
        container.classList.remove('ready');
        showLoader();
        load();
    });

    (async function () {
        const session = await requireSession();
        if (session) load();
    })();
})();