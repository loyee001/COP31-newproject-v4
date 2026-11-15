(function () {
  'use strict';
  const STORAGE_KEY = 'shadepath-sidebar-width';
  const DEFAULT_WIDTH = 250;
  const MIN_WIDTH = 176;
  const DESKTOP_MIN = 600;
  let controller = null;

  // The ceiling is based on the page viewport, including at odd pixel widths.
  // Flooring prevents the sidebar from ever exceeding half of the page.
  function clampWidth(width, viewportWidth) {
    const viewport = Number(viewportWidth);
    const maximum = Number.isFinite(viewport) ? Math.floor(Math.max(0, viewport) / 2) : 0;
    const minimum = Math.min(MIN_WIDTH, maximum);
    const value = Number(width);
    const preferred = Number.isFinite(value) ? Math.round(value) : DEFAULT_WIDTH;
    return Math.min(maximum, Math.max(minimum, preferred));
  }

  function init({ translate = (key) => key } = {}) {
    if (controller) {
      controller.setTranslate(translate);
      return controller;
    }
    if (typeof document === 'undefined') return null;
    const layout = document.querySelector('.app-layout');
    const shell = document.querySelector('.sidebar-shell');
    const handle = document.getElementById('sidebar-resizer');
    if (!layout || !shell || !handle) return null;
    let translateText = translate;
    let preferredWidth = DEFAULT_WIDTH;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null && Number.isFinite(Number(stored))) preferredWidth = Number(stored);
    } catch { /* Storage may be unavailable for offline files. */ }
    let currentWidth = DEFAULT_WIDTH;
    let pointer = null;
    const viewportWidth = () => document.documentElement.clientWidth;
    const persist = () => {
      try { localStorage.setItem(STORAGE_KEY, String(currentWidth)); } catch { /* Optional preference only. */ }
    };
    function update() {
      const pageWidth = viewportWidth();
      const maximum = Math.floor(pageWidth / 2);
      const enabled = pageWidth >= DESKTOP_MIN;
      currentWidth = clampWidth(preferredWidth, pageWidth);
      layout.style.setProperty('--sidebar-width', `${currentWidth}px`);
      handle.setAttribute('aria-valuemin', String(Math.min(MIN_WIDTH, maximum)));
      handle.setAttribute('aria-valuemax', String(maximum));
      handle.setAttribute('aria-valuenow', String(currentWidth));
      handle.setAttribute('aria-disabled', String(!enabled));
      handle.tabIndex = enabled ? 0 : -1;
      const label = translateText('拖动调整侧栏宽度，最大 50%');
      handle.setAttribute('aria-label', label);
      handle.title = label;
    }
    function stopDrag(event) {
      if (!pointer || (event && event.pointerId !== pointer.id)) return;
      const pointerId = pointer.id;
      pointer = null;
      document.documentElement.classList.remove('sidebar-resizing');
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      persist();
    }
    handle.addEventListener('pointerdown', (event) => {
      if (viewportWidth() < DESKTOP_MIN || event.button !== 0) return;
      event.preventDefault();
      pointer = { id: event.pointerId, startX: event.clientX, startWidth: shell.getBoundingClientRect().width };
      handle.setPointerCapture(event.pointerId);
      handle.focus({ preventScroll: true });
      document.documentElement.classList.add('sidebar-resizing');
    });
    handle.addEventListener('pointermove', (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      if (viewportWidth() < DESKTOP_MIN) { stopDrag(event); return; }
      preferredWidth = clampWidth(pointer.startWidth + event.clientX - pointer.startX, viewportWidth());
      update();
    });
    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);
    handle.addEventListener('lostpointercapture', stopDrag);
    handle.addEventListener('keydown', (event) => {
      if (viewportWidth() < DESKTOP_MIN) return;
      let next;
      if (event.key === 'ArrowLeft') next = currentWidth - 16;
      else if (event.key === 'ArrowRight') next = currentWidth + 16;
      else if (event.key === 'Home') next = MIN_WIDTH;
      else if (event.key === 'End') next = viewportWidth() / 2;
      else return;
      event.preventDefault();
      preferredWidth = clampWidth(next, viewportWidth());
      update();
      persist();
    });
    const onResize = () => {
      if (viewportWidth() < DESKTOP_MIN) stopDrag();
      update();
    };
    window.addEventListener('resize', onResize);
    controller = Object.freeze({
      setTranslate(next) { translateText = typeof next === 'function' ? next : (key) => key; update(); },
      refresh: update,
      get width() { return currentWidth; }
    });
    update();
    return controller;
  }
  globalThis.ShadeSidebar = Object.freeze({ clampWidth, init });
}());
