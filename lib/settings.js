const KEYS = ["apiKey", "providerId", "model", "enabled", "logLevel", "disabledSites"];

const DEFAULTS = {
  apiKey: "",
  providerId: "openai",
  model: "",
  enabled: true,
  logLevel: "info",
  disabledSites: [],
};

export async function getSettings() {
  const raw = await chrome.storage.local.get(KEYS);
  return {
    apiKey: raw.apiKey || "",
    providerId: raw.providerId || DEFAULTS.providerId,
    model: raw.model || "",
    enabled: raw.enabled !== false,
    logLevel: raw.logLevel || DEFAULTS.logLevel,
    disabledSites: raw.disabledSites || [],
  };
}

export async function setSettings(partial) {
  await chrome.storage.local.set(partial);
}
