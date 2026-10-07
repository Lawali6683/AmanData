export const LOGO = 'https://i.imgur.com/bNK9ccG.png';

const WAVE = '<svg viewBox="0 0 1200 80" preserveAspectRatio="none"><path d="M0,40 C200,80 400,0 600,40 C800,80 1000,0 1200,40 L1200,80 L0,80 Z"></path></svg>';
let el = {};
let fillTimer = null;

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
        '<div class="toast-stack" id="toastStack" aria-live="polite"></div>');
    el = {
        scene: document.getElementById('scene'),
        bg: document.getElementById('bg'),
        liquid: document.getElementById('liquid'),
        brand: document.getElementById('brand'),
        logo: document.getElementById('loaderLogo'),
        stack: document.getElementById('toastStack')
    };
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

export function reveal(container, delay) {
    setTimeout(() => hideLoader(() => { if (container) container.classList.add('ready'); }), delay === undefined ? 1200 : delay);
}

export function toast(message, type) {
    const ok = type === 'ok';
    const node = document.createElement('div');
    node.className = 'toast ' + (ok ? 'ok' : 'err');
    node.setAttribute('role', ok ? 'status' : 'alert');
    node.innerHTML = '<i class="toast-icon fa-solid ' + (ok ? 'fa-circle-check' : 'fa-circle-xmark') + '"></i><span class="toast-message"></span>';
    node.querySelector('.toast-message').textContent = message;
    el.stack.appendChild(node);
    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('show')));
    const close = () => {
        node.classList.remove('show');
        setTimeout(() => node.remove(), 400);
    };
    node.addEventListener('click', close);
    setTimeout(close, 4200);
}

export function confirmDialog(options) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML =
            '<div class="modal" role="dialog" aria-modal="true"><div class="modal-icon' + (options.danger ? ' danger' : '') + '">' +
            '<i class="fa-solid ' + (options.danger ? 'fa-trash-can' : 'fa-circle-question') + '"></i></div>' +
            '<h3></h3><p></p><div class="modal-actions"><button type="button" class="btn-small alt js-no"></button>' +
            '<button type="button" class="btn-small js-ok"></button></div></div>';
        overlay.querySelector('h3').textContent = options.title;
        overlay.querySelector('p').innerHTML = options.html;
        const no = overlay.querySelector('.js-no');
        const ok = overlay.querySelector('.js-ok');
        no.textContent = options.noLabel || 'Cancel';
        ok.textContent = options.okLabel || 'Confirm';
        if (options.danger) ok.classList.add('danger');
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('open'));
        const finish = (result) => {
            overlay.classList.remove('open');
            setTimeout(() => overlay.remove(), 250);
            resolve(result);
        };
        ok.addEventListener('click', () => finish(true));
        no.addEventListener('click', () => finish(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
    });
}