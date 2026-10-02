export const CARDS_URL = 'https://api.hearthstonejson.com/v1/latest/koKR/cards.json';

export const STORAGE_KEY_INDEX = 'cardIndex';
export const STORAGE_KEY_HOSTS = 'enabledHosts';
export const STORAGE_KEY_TABS_INJECTED = 'openTabsInjected';

// Must match the host listed under host_permissions in manifest.json.
export const DEFAULT_ENABLED_HOSTS = ['hearthstone.blizzard.com'];

export const CONTENT_SCRIPT_ID = 'card-hover';
export const CONTENT_SCRIPT_FILE = 'src/content/content.js';

export const INDEX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const MESSAGE = {
  IS_ENABLED: 'isEnabled',
  LOOKUP: 'lookup',
  INDEX_STATUS: 'indexStatus',
  REFRESH_INDEX: 'refreshIndex',
};

export function originPatternForHost(host) {
  return `*://${host}/*`;
}

export function hostOfOriginPattern(pattern) {
  return pattern.replace(/^[^:]+:\/\//, '').replace(/\/.*$/, '');
}
