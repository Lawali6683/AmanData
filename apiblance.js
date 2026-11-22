import { mountShell, showLoader, reveal, toast } from './uix.js';
import { requireSession } from './auth.js';

(function () {
    const CONFIG = Object.freeze({
        target: 'https://app.bilalsadasub.com/dashboard/app',
        slowMs: 15000,
        revealMs: 600,
        fallbackPage: 'admin.html',
        sandbox: 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox'
    });

    mountShell();
    showLoader();

    const container = document.getElementById('appContainer');
    const frame = document.getElementById('frame');

    if (!container || !frame) return;

    frame.setAttribute('sandbox', CONFIG.sandbox);
    frame.setAttribute('referrerpolicy', 'no-referrer');

    let revealed = false;
    let loading = false;
    let slowTimer = null;

    function done() {
        if (revealed) return;
        revealed = true;
        loading = false;
        clearTimeout(slowTimer);
        reveal(container, CONFIG.revealMs);
    }

    function load() {
        if (loading) return;
        loading = true;
        revealed = false;
        clearTimeout(slowTimer);
        frame.src = CONFIG.target;
        slowTimer = setTimeout(() => {
            if (revealed) return;
            done();
            toast('The page is taking long to load. Check your connection or reload.', 'err');
        }, CONFIG.slowMs);
    }

    frame.addEventListener('load', done);

    const btnBack = document.getElementById('btnBack');
    const btnRefresh = document.getElementById('btnRefresh');

    if (btnBack) {
        btnBack.addEventListener('click', () => {
            if (window.history.length > 1) window.history.back();
            else window.location.href = CONFIG.fallbackPage;
        });
    }

    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            if (loading) return;
            container.classList.remove('ready');
            showLoader();
            load();
        });
    }

    (async function () {
        const session = await requireSession();
        if (session) load();
    })();
})();
