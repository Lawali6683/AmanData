import { supabase } from './supabase.js';
import { mountShell, showLoader, reveal, toast } from './uix.js';

(function () {
    const LOGIN_PAGE = 'login.html';
    const HOME_PAGE = 'dashboard.html';
    const SLOW_MS = 20000;

    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    const frame = $('frame');
    let target = null;
    let revealed = false;
    let slowTimer = null;

    function safeUrl(value) {
        try {
            const u = new URL(String(value || '').trim());
            return u.protocol === 'https:' ? u.href : null;
        } catch (err) {
            return null;
        }
    }

    function done() {
        if (revealed) return;
        revealed = true;
        clearTimeout(slowTimer);
        reveal(container, 600);
    }

    function goBack() {
        if (window.history.length > 1) window.history.back();
        else window.location.href = HOME_PAGE;
    }

    async function findLink() {
        const { data, error } = await supabase.from('patner').select('OpenLink,botton').limit(1);
        if (error || !data || !data.length) return null;
        const row = data[0];
        let button = row.botton;
        if (typeof button === 'string') {
            try { button = JSON.parse(button); } catch (err) { button = null; }
        }
        return safeUrl(row.OpenLink) || safeUrl(button && button.link);
    }

    function open() {
        revealed = false;
        clearTimeout(slowTimer);
        slowTimer = setTimeout(() => {
            if (revealed) return;
            done();
            toast('The page is taking long to load. Check your connection or reload.', 'err');
        }, SLOW_MS);
        frame.classList.remove('hidden');
        frame.src = target;
    }

    function showEmpty() {
        frame.classList.add('hidden');
        $('emptyState').classList.remove('hidden');
        done();
    }

    async function initialize() {
        let session = null;
        try {
            const { data } = await supabase.auth.getSession();
            session = data && data.session ? data.session : null;
        } catch (err) {
            session = null;
        }
        if (!session) {
            window.location.replace(LOGIN_PAGE);
            return;
        }
        try {
            target = await findLink();
        } catch (err) {
            target = null;
        }
        if (!target) {
            showEmpty();
            return;
        }
        open();
    }

    frame.addEventListener('load', () => { if (target) done(); });
    $('btnBack').addEventListener('click', goBack);
    $('btnHome').addEventListener('click', goBack);
    $('btnRefresh').addEventListener('click', () => {
        if (!target) return;
        container.classList.remove('ready');
        showLoader();
        open();
    });

    initialize();
})();