import { MESSAGE, originPatternForHost } from '../shared/constants.js';
import { isHostEnabled, setHostEnabled } from '../shared/enabled_hosts.js';

const TEXT = {
  unsupportedPage: '이 페이지',
  loading: '카드 데이터를 불러오는 중…',
  loadFailed: '카드 데이터를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.',
  toggleFailed: '설정을 바꾸지 못했습니다. 다시 시도해 주세요.',
  status: (cardCount, date) => `카드 ${cardCount.toLocaleString('ko-KR')}장 · ${date} 갱신`,
};

const enabledCheckbox = document.getElementById('enabled');
const hostLabel = document.getElementById('host');
const statusLabel = document.getElementById('status');
const refreshButton = document.getElementById('refresh');

async function getActiveHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  const url = new URL(tab.url);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : null;
}

async function isActiveOn(host) {
  const hasAccess = await chrome.permissions.contains({ origins: [originPatternForHost(host)] });
  return hasAccess && (await isHostEnabled(host));
}

async function onToggle(host) {
  try {
    if (!enabledCheckbox.checked) {
      await setHostEnabled(host, false);
      return;
    }
    // Must be the first call in the click handler: Chrome only shows the prompt
    // during a user gesture. If the prompt closes this popup, the background
    // finishes enabling the site from its permissions.onAdded listener.
    const granted = await chrome.permissions.request({ origins: [originPatternForHost(host)] });
    if (granted) await setHostEnabled(host, true);
    else enabledCheckbox.checked = false;
  } catch (error) {
    console.warn('[popup] toggle failed', error);
    enabledCheckbox.checked = !enabledCheckbox.checked;
    statusLabel.textContent = TEXT.toggleFailed;
  }
}

async function showIndexStatus(messageType) {
  statusLabel.textContent = TEXT.loading;
  refreshButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: messageType });
    if (response.error) throw new Error(response.error);
    statusLabel.textContent = TEXT.status(response.cardCount, new Date(response.fetchedAt).toLocaleString('ko-KR'));
  } catch (error) {
    console.warn('[popup] index status failed', error);
    statusLabel.textContent = TEXT.loadFailed;
  } finally {
    refreshButton.disabled = false;
  }
}

async function init() {
  const host = await getActiveHost();
  if (host) {
    hostLabel.textContent = host;
    enabledCheckbox.checked = await isActiveOn(host);
    enabledCheckbox.addEventListener('change', () => onToggle(host));
  } else {
    hostLabel.textContent = TEXT.unsupportedPage;
    enabledCheckbox.disabled = true;
  }
  refreshButton.addEventListener('click', () => showIndexStatus(MESSAGE.REFRESH_INDEX));
  await showIndexStatus(MESSAGE.INDEX_STATUS);
}

init();
