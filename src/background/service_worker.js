import { MESSAGE, STORAGE_KEY_TABS_INJECTED, hostOfOriginPattern } from '../shared/constants.js';
import { isHostEnabled, setHostEnabled } from '../shared/enabled_hosts.js';
import { getIndex, refreshIndex } from './card_index_store.js';
import { findCardAt } from './card_matcher.js';
import { injectIntoOpenTabs, syncContentScriptRegistration } from './site_injection.js';

function describeIndex(index) {
  return { cardCount: index.cardCount, fetchedAt: index.fetchedAt };
}

async function handleMessage(message) {
  switch (message.type) {
    case MESSAGE.IS_ENABLED:
      return { enabled: await isHostEnabled(message.host) };
    case MESSAGE.LOOKUP: {
      const index = await getIndex();
      return { match: findCardAt(index.names, index.maxLength, message.text, message.offset) };
    }
    case MESSAGE.INDEX_STATUS:
      return describeIndex(await getIndex());
    case MESSAGE.REFRESH_INDEX:
      return describeIndex(await refreshIndex());
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// Session storage is wiped whenever the extension is installed, updated,
// re-enabled or the browser restarts, which are exactly the moments when
// already open tabs are left without a working content script.
async function attachToOpenTabsOncePerSession() {
  const { [STORAGE_KEY_TABS_INJECTED]: alreadyInjected } = await chrome.storage.session.get(STORAGE_KEY_TABS_INJECTED);
  if (alreadyInjected) return;
  await chrome.storage.session.set({ [STORAGE_KEY_TABS_INJECTED]: true });
  await syncContentScriptRegistration();
  await injectIntoOpenTabs();
}

// The permission prompt closes the popup before it can finish, so the grant is completed here.
async function onSitesGranted(permissions) {
  const origins = permissions.origins ?? [];
  if (origins.length === 0) return;
  for (const origin of origins) await setHostEnabled(hostOfOriginPattern(origin), true);
  await syncContentScriptRegistration();
  await injectIntoOpenTabs(origins);
}

function logFailure(action) {
  return (error) => console.warn(`[service-worker] ${action} failed`, error);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      logFailure(`message ${message.type}`)(error);
      sendResponse({ error: String(error?.message || error) });
    });
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  refreshIndex().catch(logFailure('initial card download'));
});

chrome.permissions.onAdded.addListener((permissions) => {
  onSitesGranted(permissions).catch(logFailure('site grant'));
});

chrome.permissions.onRemoved.addListener(() => {
  syncContentScriptRegistration().catch(logFailure('content script registration'));
});

attachToOpenTabsOncePerSession().catch(logFailure('attach to open tabs'));
