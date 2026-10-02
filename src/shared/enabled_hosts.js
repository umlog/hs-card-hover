import { DEFAULT_ENABLED_HOSTS, STORAGE_KEY_HOSTS } from './constants.js';

export async function getEnabledHosts() {
  const { [STORAGE_KEY_HOSTS]: hosts } = await chrome.storage.sync.get(STORAGE_KEY_HOSTS);
  return Array.isArray(hosts) ? hosts : DEFAULT_ENABLED_HOSTS;
}

export async function isHostEnabled(host) {
  return (await getEnabledHosts()).includes(host);
}

export async function setHostEnabled(host, enabled) {
  const hosts = (await getEnabledHosts()).filter((existing) => existing !== host);
  if (enabled) hosts.push(host);
  await chrome.storage.sync.set({ [STORAGE_KEY_HOSTS]: hosts });
}
