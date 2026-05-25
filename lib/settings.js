const KEYS = ["apiKey", "providerId", "model", "baseUrl", "enabled", "logLevel", "disabledSites"];

const DEFAULTS = {
  apiKey: "",
  providerId: "openai",
  model: "",
  baseUrl: "",
  enabled: true,
  logLevel: "info",
  disabledSites: [],
};

let settingsCache = null;
let lastFetchTime = 0;
const CACHE_TTL = 1000;

export async function getSettings(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && settingsCache && now - lastFetchTime < CACHE_TTL) {
    return settingsCache;
  }
  const raw = await chrome.storage.local.get(KEYS);
  settingsCache = {
    apiKey: raw.apiKey || "",
    providerId: raw.providerId || DEFAULTS.providerId,
    model: raw.model || "",
    baseUrl: raw.baseUrl || "",
    enabled: raw.enabled !== false,
    logLevel: raw.logLevel || DEFAULTS.logLevel,
    disabledSites: raw.disabledSites || [],
  };
  lastFetchTime = now;
  return settingsCache;
}

export async function setSettings(partial) {
  await chrome.storage.local.set(partial);
  settingsCache = null;
}

export function clearSettingsCache() {
  settingsCache = null;
}
