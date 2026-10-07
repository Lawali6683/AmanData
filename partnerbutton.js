import { supabase } from './supabase.js';
import { mountShell, showLoader, hideLoader, reveal, toast, confirmDialog } from './uix.js';
import { requireSession } from './auth.js';

(function () {
    mountShell();
    showLoader();

    const $ = (id) => document.getElementById(id);
    const container = $('appContainer');
    const imageUrl = $('imageUrl');
    const openLink = $('openLink');
    const previewBox = $('previewBox');
    const previewImage = $('previewImage');
    const previewMsg = $('previewMsg');
    let busy = false;

    function validUrl(value) {
        try {
            const u = new URL(value);
            return u.protocol === 'https:' || u.protocol === 'http:';
        } catch (err) {
            return false;
        }
    }

    function setPreview(value) {
        const url = value.trim();
        if (!url) {
            previewBox.classList.add('hidden');
            previewImage.removeAttribute('src');
            return;
        }
        previewBox.classList.remove('hidden');
        previewMsg.textContent = '';
        previewImage.style.display = 'block';
        previewImage.onerror = () => {
            previewImage.style.display = 'none';
            previewMsg.textContent = 'This image could not be loaded.';
        };
        if (previewImage.getAttribute('src') !== url) previewImage.src = url;
    }

    async function loadCurrent() {
        try {
            const { data, error } = await supabase.from('patner').select('imageUrl,OpenLink').limit(1);
            if (error || !data || !data.length) return;
            imageUrl.value = data[0].imageUrl || '';
            openLink.value = data[0].OpenLink || '';
            setPreview(imageUrl.value);
        } catch (err) {}
    }

    async function save(event) {
        event.preventDefault();
        if (busy) return;
        const image = imageUrl.value.trim();
        const link = openLink.value.trim();
        if (!validUrl(image)) {
            toast('Enter a valid image link starting with https://', 'err');
            imageUrl.focus();
            return;
        }
        if (!validUrl(link)) {
            toast('Enter a valid button link starting with https://', 'err');
            openLink.focus();
            return;
        }
        busy = true;
        showLoader();
        try {
            const removed = await supabase.from('patner').delete().neq('id', '__pb_none__');
            if (removed.error) throw removed.error;
            const added = await supabase.from('patner').insert({
                id: 'partner_' + Date.now(),
                botton: { url: image, link: link },
                imageUrl: image,
                OpenLink: link
            });
            if (added.error) throw added.error;
            try { localStorage.removeItem('puredata_partner_button_cache'); } catch (err) {}
            hideLoader();
            toast('Partner button saved.', 'ok');
        } catch (err) {
            hideLoader();
            toast((err && err.message) || 'Could not save the partner button.', 'err');
        }
        busy = false;
    }

    async function clearButton() {
        if (busy) return;
        const ok = await confirmDialog({
            title: 'Remove button',
            html: 'This removes the partner button from the user dashboard.',
            okLabel: 'Remove',
            noLabel: 'Keep',
            danger: true
        });
        if (!ok) return;
        busy = true;
        showLoader();
        try {
            const removed = await supabase.from('patner').delete().neq('id', '__pb_none__');
            if (removed.error) throw removed.error;
            try { localStorage.removeItem('puredata_partner_button_cache'); } catch (err) {}
            imageUrl.value = '';
            openLink.value = '';
            setPreview('');
            hideLoader();
            toast('Partner button removed.', 'ok');
        } catch (err) {
            hideLoader();
            toast((err && err.message) || 'Could not remove the partner button.', 'err');
        }
        busy = false;
    }

    async function initialize() {
        try {
            const session = await requireSession();
            if (!session) return;
            await loadCurrent();
        } finally {
            reveal(container, 1200);
        }
    }

    $('btnBack').addEventListener('click', () => { window.location.href = 'admin.html'; });
    $('pbForm').addEventListener('submit', save);
    $('btnClear').addEventListener('click', clearButton);
    imageUrl.addEventListener('input', () => setPreview(imageUrl.value));

    initialize();
})();