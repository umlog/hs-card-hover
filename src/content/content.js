// Content scripts cannot use static ES imports, so the few constants shared
// with the background (message types, storage key) are repeated here.
(() => {
  const MESSAGE_IS_ENABLED = 'isEnabled';
  const MESSAGE_LOOKUP = 'lookup';
  const STORAGE_KEY_HOSTS = 'enabledHosts';
  const TAKEOVER_EVENT = 'hs-card-hover:takeover';

  const HOVER_DELAY_MS = 100;
  const CONTEXT_CHARS = 48;
  const MAX_VISIBLE_CARDS = 4;
  const CARD_WIDTH_PX = 240;
  const CARD_HEIGHT_PX = 364;
  const CARD_GAP_PX = 8;
  const VIEWPORT_MARGIN_PX = 8;
  const ANCHOR_GAP_PX = 6;
  const HIT_PADDING_PX = 2;
  const MAX_Z_INDEX = 2147483647;

  const ART_BASE_URL = 'https://art.hearthstonejson.com/v1';
  const ART_LOCALE = 'koKR';
  const ART_SIZE = '256x';
  const LOAD_ERROR_TEXT = '카드 데이터를 불러오지 못했습니다. 확장 프로그램 팝업에서 새로고침해 주세요.';

  let enabled = false;
  let hoverTimer = null;
  let lastPointer = null;
  let activeRects = null;
  let requestSequence = 0;
  let tooltip = null;

  function artUrl(cardId, battlegrounds) {
    const kind = battlegrounds ? 'bgs' : 'render';
    return `${ART_BASE_URL}/${kind}/latest/${ART_LOCALE}/${ART_SIZE}/${cardId}.png`;
  }

  function getTooltip() {
    if (tooltip) return tooltip;
    const host = document.createElement('div');
    host.style.cssText = `all: initial; position: fixed; left: 0; top: 0; z-index: ${MAX_Z_INDEX}; pointer-events: none;`;
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .panel { position: fixed; display: none; gap: ${CARD_GAP_PX}px; align-items: flex-start; }
      .panel.visible { display: flex; }
      img { width: var(--card-width); height: var(--card-height); object-fit: contain;
            filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.55)); }
      .message { max-width: 260px; padding: 8px 10px; border-radius: 6px; background: #1f1a14; color: #f3e6c8;
                 font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.45); }
    `;
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'tooltip');
    shadow.append(style, panel);
    document.documentElement.append(host);
    tooltip = { host, panel };
    return tooltip;
  }

  function hideTooltip() {
    activeRects = null;
    if (tooltip) tooltip.panel.classList.remove('visible');
  }

  function createCardImage(card, name) {
    const image = document.createElement('img');
    image.alt = name;
    image.src = artUrl(card.id, card.battlegrounds);
    let triedOtherRender = false;
    image.addEventListener('error', () => {
      // A few cards only exist under the other render kind.
      if (triedOtherRender) {
        image.remove();
        return;
      }
      triedOtherRender = true;
      image.src = artUrl(card.id, !card.battlegrounds);
    });
    return image;
  }

  function placePanel(panel, anchor, cardCount) {
    const availableWidth = window.innerWidth - VIEWPORT_MARGIN_PX * 2;
    const naturalWidth = cardCount * CARD_WIDTH_PX + (cardCount - 1) * CARD_GAP_PX;
    const scale = Math.min(1, availableWidth / naturalWidth);
    const cardWidth = Math.floor(CARD_WIDTH_PX * scale);
    const cardHeight = Math.floor(CARD_HEIGHT_PX * scale);
    const panelWidth = cardCount * cardWidth + (cardCount - 1) * CARD_GAP_PX;
    panel.style.setProperty('--card-width', `${cardWidth}px`);
    panel.style.setProperty('--card-height', `${cardHeight}px`);

    // Prefer above the name: the lines a reader wants next (the change details) sit below it.
    const topAbove = anchor.top - ANCHOR_GAP_PX - cardHeight;
    const maxTop = window.innerHeight - VIEWPORT_MARGIN_PX - cardHeight;
    const top = topAbove >= VIEWPORT_MARGIN_PX ? topAbove : Math.max(VIEWPORT_MARGIN_PX, Math.min(anchor.bottom + ANCHOR_GAP_PX, maxTop));
    const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(anchor.left, window.innerWidth - VIEWPORT_MARGIN_PX - panelWidth));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function showCards(match, rects) {
    const { panel } = getTooltip();
    const cards = match.cards.slice(0, MAX_VISIBLE_CARDS);
    panel.replaceChildren(...cards.map((card) => createCardImage(card, match.name)));
    placePanel(panel, rects[0], cards.length);
    panel.classList.add('visible');
    activeRects = rects;
  }

  function showMessage(text, pointer) {
    const { panel } = getTooltip();
    const message = document.createElement('div');
    message.className = 'message';
    message.textContent = text;
    panel.replaceChildren(message);
    panel.style.left = `${pointer.x + ANCHOR_GAP_PX}px`;
    panel.style.top = `${pointer.y + ANCHOR_GAP_PX}px`;
    panel.classList.add('visible');
  }

  function rectsContain(rects, pointer) {
    return rects.some(
      (rect) =>
        pointer.x >= rect.left - HIT_PADDING_PX &&
        pointer.x <= rect.right + HIT_PADDING_PX &&
        pointer.y >= rect.top - HIT_PADDING_PX &&
        pointer.y <= rect.bottom + HIT_PADDING_PX,
    );
  }

  function rangeRects(textNode, start, end) {
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    return [...range.getClientRects()];
  }

  function caretAt(pointer) {
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(pointer.x, pointer.y);
      return position && { node: position.offsetNode, offset: position.offset };
    }
    const range = document.caretRangeFromPoint(pointer.x, pointer.y);
    return range && { node: range.startContainer, offset: range.startOffset };
  }

  // The caret API snaps to the nearest gap between characters even when the
  // pointer is over empty space, so confirm which character is really under it.
  function characterUnderPointer(pointer) {
    const caret = caretAt(pointer);
    if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
    const length = caret.node.data.length;
    for (const index of [caret.offset - 1, caret.offset]) {
      if (index < 0 || index >= length) continue;
      if (rectsContain(rangeRects(caret.node, index, index + 1), pointer)) {
        return { textNode: caret.node, index };
      }
    }
    return null;
  }

  async function lookUpCardUnder(pointer) {
    const target = characterUnderPointer(pointer);
    if (!target) return;
    const { textNode, index } = target;
    const windowStart = Math.max(0, index - CONTEXT_CHARS);
    const text = textNode.data.slice(windowStart, index + CONTEXT_CHARS).replace(/ /g, ' ');

    const sequence = ++requestSequence;
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: MESSAGE_LOOKUP, text, offset: index - windowStart });
    } catch (error) {
      // Thrown when the extension was reloaded under an already open page.
      enabled = false;
      console.warn('[hs-card-hover] extension unavailable, reload the page', error);
      return;
    }
    if (sequence !== requestSequence) return;
    if (!response || response.error) {
      showMessage(LOAD_ERROR_TEXT, pointer);
      return;
    }
    if (!response.match || !textNode.isConnected) return;

    const rects = rangeRects(textNode, windowStart + response.match.start, windowStart + response.match.end);
    if (rects.length > 0 && rectsContain(rects, lastPointer)) showCards(response.match, rects);
  }

  function onPointerMove(event) {
    if (!enabled) return;
    lastPointer = { x: event.clientX, y: event.clientY };
    if (activeRects) {
      if (rectsContain(activeRects, lastPointer)) return;
      hideTooltip();
    }
    clearTimeout(hoverTimer);
    const pointer = lastPointer;
    hoverTimer = setTimeout(() => lookUpCardUnder(pointer), HOVER_DELAY_MS);
  }

  function cancelHover() {
    clearTimeout(hoverTimer);
    requestSequence++;
    hideTooltip();
  }

  async function syncEnabled() {
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE_IS_ENABLED, host: location.hostname });
      enabled = Boolean(response?.enabled);
    } catch (error) {
      enabled = false;
      console.warn('[hs-card-hover] could not read site setting', error);
    }
    if (!enabled) cancelHover();
  }

  function onStorageChanged(changes) {
    if (changes[STORAGE_KEY_HOSTS]) syncEnabled();
  }

  // The background injects this script again into open tabs after the extension
  // is installed, updated or re-enabled. The older copy can no longer reach the
  // extension, so it steps aside when the newer one announces itself.
  function shutDown() {
    enabled = false;
    cancelHover();
    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('scroll', cancelHover, { capture: true });
    document.removeEventListener('mouseleave', cancelHover);
    document.removeEventListener(TAKEOVER_EVENT, shutDown);
    if (tooltip) tooltip.host.remove();
    try {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    } catch {
      // An orphaned copy has no extension APIs left; there is nothing to detach.
    }
  }

  document.dispatchEvent(new CustomEvent(TAKEOVER_EVENT));
  document.addEventListener(TAKEOVER_EVENT, shutDown);
  document.addEventListener('mousemove', onPointerMove, { passive: true });
  document.addEventListener('scroll', cancelHover, { passive: true, capture: true });
  document.addEventListener('mouseleave', cancelHover);
  chrome.storage.onChanged.addListener(onStorageChanged);
  syncEnabled();
})();
