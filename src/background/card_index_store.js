import { CARDS_URL, INDEX_MAX_AGE_MS, STORAGE_KEY_INDEX } from '../shared/constants.js';
import { buildIndex } from './card_matcher.js';

// The service worker is torn down when idle, so the in-memory copy is only a
// cache in front of chrome.storage.local.
let loadedIndex = null;
let pendingDownload = null;

function toLoadedIndex(stored) {
  return {
    names: new Map(Object.entries(stored.names)),
    maxLength: stored.maxLength,
    cardCount: stored.cardCount,
    fetchedAt: stored.fetchedAt,
  };
}

async function downloadIndex() {
  const response = await fetch(CARDS_URL);
  if (!response.ok) throw new Error(`cards.json request failed: HTTP ${response.status}`);
  const stored = { ...buildIndex(await response.json()), fetchedAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE_KEY_INDEX]: stored });
  loadedIndex = toLoadedIndex(stored);
  return loadedIndex;
}

export function refreshIndex() {
  if (!pendingDownload) {
    pendingDownload = downloadIndex().finally(() => {
      pendingDownload = null;
    });
  }
  return pendingDownload;
}

export async function getIndex() {
  if (!loadedIndex) {
    const { [STORAGE_KEY_INDEX]: stored } = await chrome.storage.local.get(STORAGE_KEY_INDEX);
    if (!stored) return refreshIndex();
    loadedIndex = toLoadedIndex(stored);
  }
  if (Date.now() - loadedIndex.fetchedAt > INDEX_MAX_AGE_MS) {
    // Serve the stale index now; a failed refresh keeps it and retries on the next lookup.
    refreshIndex().catch((error) => console.warn('[card-index] refresh failed', error));
  }
  return loadedIndex;
}
