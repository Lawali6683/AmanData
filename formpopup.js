(function () {
    const form = document.getElementById('buyForm');
    if (!form || form.dataset.popupReady) return;
    form.dataset.popupReady = '1';
    document.body.classList.add('fp-on');

    const backdrop = document.createElement('div');
    backdrop.className = 'form-backdrop';
    form.parentNode.insertBefore(backdrop, form);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'form-close';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    form.insertBefore(close, form.firstChild);

    const isOpen = () => !form.classList.contains('hidden') && !form.hasAttribute('hidden');

    function sync() {
        const open = isOpen();
        backdrop.classList.toggle('open', open);
        document.body.classList.toggle('fp-lock', open);
    }

    function hide() {
        form.classList.add('hidden');
        sync();
    }

    new MutationObserver(sync).observe(form, { attributes: true, attributeFilter: ['class', 'hidden'] });
    close.addEventListener('click', hide);
    backdrop.addEventListener('click', hide);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) hide(); });
    sync();
})();
