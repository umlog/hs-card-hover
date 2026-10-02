import { CONTENT_SCRIPT_FILE, CONTENT_SCRIPT_ID } from '../shared/constants.js';

// Registration calls race when several events arrive together (startup plus a
// permission grant), and registering the same id twice throws, so run them one at a time.
let registrationQueue = Promise.resolve();

async function registerForGrantedOrigins() {
  const { origins = [] } = await chrome.permissions.getAll();
  const [existing] = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  if (origins.length === 0) {
    if (existing) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    return;
  }
  const script = { id: CONTENT_SCRIPT_ID, js: [CONTENT_SCRIPT_FILE], matches: origins, runAt: 'document_idle' };
  if (existing) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
}

/** Makes the content script load on every site the user has granted, and only those. */
export function syncContentScriptRegistration() {
  registrationQueue = registrationQueue.catch(() => {}).then(registerForGrantedOrigins);
  return registrationQueue;
}

/**
 * Registered content scripts only run on future page loads, so tabs that are
 * already open get the script injected directly.
 * @param {string[]} [origins] match patterns; defaults to every granted origin
 */
export async function injectIntoOpenTabs(origins) {
  const patterns = origins ?? (await chrome.permissions.getAll()).origins ?? [];
  if (patterns.length === 0) return;
  const tabs = await chrome.tabs.query({ url: patterns });
  await Promise.all(
    tabs.map((tab) =>
      chrome.scripting
        .executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT_FILE] })
        .catch((error) => console.warn('[site-injection] could not inject into tab', tab.id, error)),
    ),
  );
}
