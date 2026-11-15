(function () {
  'use strict';

  let nextId = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function init({container}) {
    if (!container) throw new Error('校园原图需要一个显示容器。');

    const events = new AbortController();
    const listen = (node, type, handler) => node.addEventListener(type, handler, {signal: events.signal});
    let source = '';
    let title = '校园原图';
    let originalSize = false;
    let destroyed = false;

    const panel = element('section', 'original-map-panel');
    const header = element('div', 'original-map-head');
    const headingGroup = element('div', 'original-map-heading');
    const heading = element('h3', 'original-map-title', title);
    const caption = element('p', 'original-map-caption', '用户提供的校园平面图');
    const openButton = element('button', 'original-map-button', '放大原图');
    openButton.type = 'button';
    headingGroup.append(heading, caption);
    header.append(headingGroup, openButton);

    const previewButton = element('button', 'original-map-preview');
    previewButton.type = 'button';
    previewButton.setAttribute('aria-label', '放大校园原图');
    const previewImage = element('img', 'original-map-image');
    previewImage.decoding = 'async';
    previewImage.draggable = false;
    previewButton.append(previewImage);
    panel.append(header, previewButton);
    container.append(panel);
    container.hidden = true;

    const dialog = element('dialog', 'original-map-dialog');
    const dialogHeader = element('div', 'original-map-dialog-head');
    const dialogHeading = element('div', 'original-map-heading');
    const dialogTitle = element('h2', 'original-map-title', title);
    dialogTitle.id = `original-map-title-${++nextId}`;
    dialog.setAttribute('aria-labelledby', dialogTitle.id);
    const dimensions = element('p', 'original-map-caption', '用户提供的校园平面图');
    dialogHeading.append(dialogTitle, dimensions);

    const actions = element('div', 'original-map-actions');
    const fitButton = element('button', 'original-map-button', '适应窗口');
    const sizeButton = element('button', 'original-map-button', '原始尺寸');
    const closeButton = element('button', 'original-map-button', '关闭');
    [fitButton, sizeButton, closeButton].forEach(button => { button.type = 'button'; });
    closeButton.autofocus = true;
    actions.append(fitButton, sizeButton, closeButton);
    dialogHeader.append(dialogHeading, actions);

    const viewport = element('div', 'original-map-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('aria-label', '校园原图；原始尺寸下可滚动查看');
    const fullImage = element('img', 'original-map-full-image');
    fullImage.decoding = 'async';
    fullImage.draggable = false;
    viewport.append(fullImage);
    dialog.append(dialogHeader, viewport);
    document.body.append(dialog);

    function setSize(value) {
      originalSize = value;
      dialog.classList.toggle('original-map-at-natural-size', value);
      fitButton.setAttribute('aria-pressed', String(!value));
      sizeButton.setAttribute('aria-pressed', String(value));
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
    }

    function close() {
      if (dialog.open) dialog.close();
    }

    function open() {
      if (destroyed || !source) return false;
      if (!dialog.open) dialog.showModal();
      return true;
    }

    listen(openButton, 'click', open);
    listen(previewButton, 'click', open);
    listen(closeButton, 'click', close);
    listen(fitButton, 'click', () => { if (originalSize) setSize(false); });
    listen(sizeButton, 'click', () => { if (!originalSize) setSize(true); });
    listen(dialog, 'click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
    listen(fullImage, 'load', () => {
      if (!source) return;
      dimensions.textContent = `用户提供的校园平面图 · ${fullImage.naturalWidth} × ${fullImage.naturalHeight} px`;
    });

    setSize(false);

    function update(campus) {
      if (destroyed) return;
      const nextSource = typeof campus?.image?.dataUrl === 'string' ? campus.image.dataUrl : '';
      if (!nextSource) {
        container.hidden = true;
        close();
        if (source) {
          source = '';
          previewImage.removeAttribute('src');
          fullImage.removeAttribute('src');
          setSize(false);
        }
        return;
      }

      const campusName = typeof campus.metadata?.campusName === 'string' ? campus.metadata.campusName.trim() : '';
      title = campus.metadata?.presetId === 'tsinghua-plan' ? '清华大学校区原图' : campusName || '校园原图';
      if (heading.textContent !== title) {
        heading.textContent = title;
        dialogTitle.textContent = title;
      }
      previewImage.alt = title;
      fullImage.alt = title;
      previewButton.setAttribute('aria-label', `放大${title}`);
      container.hidden = false;

      // The sun animation updates frequently. Preserve the images, dialog and
      // scroll position until the actual imported image changes.
      if (nextSource === source) return;
      source = nextSource;
      dimensions.textContent = '用户提供的校园平面图';
      setSize(false);
      previewImage.src = source;
      fullImage.src = source;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      close();
      events.abort();
      dialog.remove();
      panel.remove();
      container.hidden = true;
      source = '';
    }

    return Object.freeze({update, open, destroy});
  }

  globalThis.ShadeOriginalMap = Object.freeze({init});
})();
