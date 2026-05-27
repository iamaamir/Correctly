import { createLogger } from "../lib/logger.js";
import { getSettings, setSettings } from "../lib/settings.js";
import { sanitizeBaseUrl, validateBaseUrl } from "../lib/url-utils.js";
import { createProvider, getAvailableProviders } from "../providers/provider-registry.js";

const log = createLogger("popup");

const providerSelect = document.getElementById("provider-select");
const modelSelect = document.getElementById("model-select");
const customModelInput = document.getElementById("custom-model");
const modelHint = document.getElementById("model-hint");
const apiKeyInput = document.getElementById("api-key");
const saveBtn = document.getElementById("save-btn");
const statusMsg = document.getElementById("status-msg");
const toggleVisibility = document.getElementById("toggle-visibility");
const enabledToggle = document.getElementById("enabled-toggle");
const siteSection = document.getElementById("site-section");
const siteToggle = document.getElementById("site-toggle");
const siteHost = document.getElementById("site-host");
const logLevelSelect = document.getElementById("log-level");
const resetCacheBtn = document.getElementById("reset-cache-btn");
const confidenceSection = document.getElementById("verify-confidence");
const giRow = document.getElementById("gi-row");
const giEmojis = document.getElementById("gi-emojis");
const giTitle = document.getElementById("gi-title");
const giDesc = document.getElementById("gi-desc");
const giSpeed = document.getElementById("gi-speed");
const aiStatusSection = document.getElementById("ai-status-section");
const aiStatusContent = document.getElementById("ai-status-content");
const baseUrlSection = document.getElementById("base-url-section");
const baseUrlInput = document.getElementById("base-url");
const fetchModelsBtn = document.getElementById("fetch-models-btn");
const baseUrlHint = document.getElementById("base-url-hint");

let currentHostname = null;

const CUSTOM_VALUE = "__custom__";
const NO_API_KEY_SENTINEL = "noapikeyrequired";
const OPENAI_COMPATIBLE_ID = "openai-compatible";
const SAVED_URLS_KEY = "savedBaseUrls";
let providers = [];
let savedState = {};

const MODELS_CACHE_KEY = "fetchedModelsCache";
const MODELS_CACHE_TTL = 5 * 60 * 1000;
const MODEL_CACHE_MEM = new Map();

async function getCachedModels(baseUrl, apiKey) {
  const cacheKey = `${baseUrl}|${apiKey || ""}`;
  const mem = MODEL_CACHE_MEM.get(cacheKey);
  if (mem && Date.now() - mem.timestamp < MODELS_CACHE_TTL) return mem.models;
  const data = await chrome.storage.session.get(MODELS_CACHE_KEY);
  const storage = data[MODELS_CACHE_KEY];
  if (
    storage &&
    storage.cacheKey === cacheKey &&
    Date.now() - storage.timestamp < MODELS_CACHE_TTL
  ) {
    MODEL_CACHE_MEM.set(cacheKey, {
      models: storage.models,
      timestamp: storage.timestamp,
    });
    return storage.models;
  }
  return null;
}

async function setCachedModels(baseUrl, apiKey, models) {
  const cacheKey = `${baseUrl}|${apiKey || ""}`;
  MODEL_CACHE_MEM.set(cacheKey, { models, timestamp: Date.now() });
  await chrome.storage.session.set({
    [MODELS_CACHE_KEY]: { cacheKey, models, timestamp: Date.now() },
  });
}

function applyFetchedModels(provider, models, selectedModel) {
  const fetched = models || [];
  const limited = fetched.slice(0, 20);
  if (provider) provider.models = limited;
  renderModelDropdown(limited, selectedModel || limited[0]?.id, provider?.defaultModel);
  baseUrlHint.textContent = "";
}

const SAVED_URLS_SET = new Set();
let savedUrlsLoaded = false;
let pendingUrlSave = null;

async function loadSavedUrls() {
  if (savedUrlsLoaded) return;
  const { [SAVED_URLS_KEY]: saved = [] } = await chrome.storage.local.get(SAVED_URLS_KEY);
  for (const url of saved) SAVED_URLS_SET.add(url);
  savedUrlsLoaded = true;
}

async function populateBaseUrlSuggestions() {
  const datalist = document.getElementById("base-url-suggestions");
  if (!datalist) return;
  await loadSavedUrls();
  datalist.innerHTML = Array.from(SAVED_URLS_SET)
    .map((url) => `<option value="${url}">`)
    .join("");
}

async function saveBaseUrlSuggestion(url) {
  const safeUrl = sanitizeBaseUrl(url);
  if (!safeUrl) return;
  await loadSavedUrls();
  if (SAVED_URLS_SET.has(safeUrl)) return;
  SAVED_URLS_SET.add(safeUrl);
  if (pendingUrlSave) clearTimeout(pendingUrlSave);
  pendingUrlSave = setTimeout(async () => {
    await chrome.storage.local.set({
      [SAVED_URLS_KEY]: Array.from(SAVED_URLS_SET).slice(0, 20),
    });
    pendingUrlSave = null;
  }, 500);
}

let statusTimer;
function showStatus(message, type = "success") {
  const DURATIONS = {
    success: 2500,
    info: 4000,
    warning: 5000,
    error: 6500,
  };

  const MIN_DURATION_MS = 3000;
  const MAX_DURATION_MS = 8000;
  const MS_PER_CHARACTER = 45;

  clearTimeout(statusTimer); // to avoid double msg

  statusMsg.textContent = message;
  statusMsg.className = `status ${type}`;
  statusMsg.hidden = false;

  const baseDuration = DURATIONS[type] ?? DURATIONS.info;

  const readingTime = message.length * MS_PER_CHARACTER;

  const duration = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, baseDuration + readingTime));

  statusTimer = setTimeout(() => {
    statusMsg.hidden = true;
  }, duration);
}

function captureSavedState() {
  savedState = {
    providerId: providerSelect.value,
    model: getSelectedModel(),
    apiKey: apiKeyInput.value,
    baseUrl: baseUrlInput.value,
    enabled: enabledToggle.checked,
    logLevel: logLevelSelect.value,
  };
}

function hasUnsavedChanges() {
  return (
    savedState.providerId !== providerSelect.value ||
    savedState.model !== getSelectedModel() ||
    savedState.apiKey !== apiKeyInput.value ||
    savedState.baseUrl !== baseUrlInput.value ||
    savedState.enabled !== enabledToggle.checked ||
    savedState.logLevel !== logLevelSelect.value
  );
}

function updateMarkUnsaved() {
  const unsaved = hasUnsavedChanges();
  saveBtn.className = unsaved ? "btn-primary btn-unsaved" : "btn-primary";
  if (unsaved) {
    saveBtn.textContent = "Unsaved changes";
  } else {
    saveBtn.textContent = "Save";
  }
}

function isCustomSelected() {
  return modelSelect.value === CUSTOM_VALUE;
}

function getSelectedModel() {
  if (isCustomSelected()) {
    return customModelInput.value.trim();
  }
  return modelSelect.value;
}

function setCustomInputVisibility(show) {
  customModelInput.hidden = !show;
  if (show) {
    customModelInput.focus();
  }
}

function renderModelDropdown(models, selectedModel, defaultModel) {
  modelSelect.innerHTML = "";
  modelHint.textContent = "";
  customModelInput.value = "";
  setCustomInputVisibility(false);

  if (models && models.length > 0) {
    const frag = document.createDocumentFragment();
    for (const m of models) {
      const option = document.createElement("option");
      option.value = m.id;
      option.textContent = m.label;
      frag.appendChild(option);
    }
    modelSelect.appendChild(frag);
  }

  const customOption = document.createElement("option");
  customOption.value = CUSTOM_VALUE;
  customOption.textContent = "Custom model...";
  modelSelect.appendChild(customOption);

  if (selectedModel) {
    const isKnown = models?.some((m) => m.id === selectedModel);
    if (isKnown) {
      modelSelect.value = selectedModel;
    } else {
      modelSelect.value = CUSTOM_VALUE;
      customModelInput.value = selectedModel;
      setCustomInputVisibility(true);
    }
  } else if (models && models.length > 0) {
    modelSelect.value = defaultModel || models[0].id;
  } else {
    modelSelect.value = CUSTOM_VALUE;
    setCustomInputVisibility(true);
  }

  updateModelHint();
}

async function populateModels(providerId, selectedModel) {
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return;

  // Loading state
  modelSelect.innerHTML = "";
  const loadingOpt = document.createElement("option");
  loadingOpt.disabled = true;
  loadingOpt.textContent = "Loading models…";
  modelSelect.appendChild(loadingOpt);

  // Lazy-fetch models via _classRef (async, cached per provider).
  if (provider._classRef) {
    provider.models = await provider._classRef.getModels();
  }

  renderModelDropdown(provider.models, selectedModel, provider.defaultModel);
}

function updateModelHint() {
  if (isCustomSelected()) {
    modelHint.textContent = "Enter any model ID supported by this provider";
    return;
  }
  const provider = providers.find((p) => p.id === providerSelect.value);
  if (!provider) return;
  const model = provider.models.find((m) => m.id === modelSelect.value);
  modelHint.textContent = model?.hint || "";
}

function showAiStatus(providerId) {
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return;

  if (providerId === "chrome-free-ai") {
    aiStatusSection.hidden = false;
    aiStatusContent.innerHTML = `<p class="status-info">Checking model status…</p>`;

    chrome.runtime
      .sendMessage({ type: "GET_AI_STATUS", providerId })
      .then((result) => {
        if (!result?.status) {
          aiStatusContent.innerHTML = `<p class="status-error">Could not check model status</p>`;
          return;
        }

        const s = result.status;

        if (s === "available") {
          aiStatusContent.innerHTML = `<p class="status-ready">✓ Local Gemini Nano ready to use</p>`;
        } else if (s === "downloadable") {
          aiStatusContent.innerHTML = `
          <p class="status-info">Gemini Nano needs to be downloaded (~22GB free space required)</p>
          <button id="download-ai-btn" class="btn-primary">Download Gemini Nano</button>
        `;
          document.getElementById("download-ai-btn").addEventListener("click", () => {
            chrome.runtime.sendMessage({ type: "TRIGGER_MODEL_DOWNLOAD" });
            aiStatusContent.innerHTML = `<p class="status-info">Download started. Check back later.</p>`;
          });
        } else if (s === "downloading") {
          aiStatusContent.innerHTML = `<p class="status-info">Model download in progress. Check back later.</p>`;
        } else {
          aiStatusContent.innerHTML = `
          <p class="status-error">✗ Chrome Free AI not supported on this browser</p>
          <p class="status-hint">
          This browser does not currently support the required AI capabilities.
      Please try a supported browser such as Google chrome.
          </p>
        `;
        }
      })
      .catch((err) => {
        log.error("GET_AI_STATUS failed:", err.message);
        aiStatusContent.innerHTML = `<p class="status-error">Error checking model status</p>`;
      });
    return;
  }

  // Other providers: show availability status
  aiStatusSection.hidden = provider.available;
  if (!provider.available) {
    const hint = provider._classRef.availabilityHint;
    aiStatusContent.innerHTML = `
      <p class="status-error">✗ ${provider.name} is not available</p>
      ${hint ? `<p class="status-hint">${hint}</p>` : ""}
    `;
  }
}

async function populateProviders() {
  providers = await getAvailableProviders();
  const frag = document.createDocumentFragment();
  for (const p of providers) {
    const option = document.createElement("option");
    option.value = p.id;
    option.textContent = p.available ? p.name : `${p.name} (unavailable)`;
    frag.appendChild(option);
  }
  providerSelect.appendChild(frag);

  providerSelect.addEventListener("change", async () => {
    const provider = providers.find((p) => p.id === providerSelect.value);
    if (provider) {
      log.info(`Provider changed to: ${provider.name} (${provider.id})`);
      apiKeyInput.placeholder = provider.keyPlaceholder;
      const isGeneric = provider.id === OPENAI_COMPATIBLE_ID;
      baseUrlSection.hidden = !isGeneric;
      if (isGeneric) {
        const { baseUrl } = await getSettings();
        baseUrlInput.value = baseUrl || "";
        baseUrlHint.textContent = "Full API base URL including version path";
      }
      await populateModels(provider.id, null);
      showAiStatus(provider.id);
      updateMarkUnsaved();
    }
  });

  modelSelect.addEventListener("change", () => {
    log.debug(`Model changed to: ${isCustomSelected() ? "custom" : modelSelect.value}`);
    setCustomInputVisibility(isCustomSelected());
    updateModelHint();
    updateMarkUnsaved();
    confidenceSection.hidden = true;
  });

  document.getElementById("reset-cache-btn").addEventListener("click", async () => {
    await chrome.storage.local.remove("modelLevelCache");
    showStatus("Model cache cleared", "info");
    log.info("Model level cache cleared");
  });

  async function doFetchModels(baseUrl, apiKey) {
    const cached = await getCachedModels(baseUrl, apiKey);
    if (cached) {
      log.debug("Using cached models for", baseUrl);
      const provider = providers.find((p) => p.id === providerSelect.value);
      applyFetchedModels(provider, cached, null);
      return;
    }

    fetchModelsBtn.disabled = true;
    fetchModelsBtn.textContent = "Fetching...";
    baseUrlHint.textContent = "Fetching models…";

    const result = await chrome.runtime.sendMessage({
      type: "FETCH_MODELS",
      baseUrl,
      apiKey,
    });

    if (!result.success) {
      baseUrlHint.textContent = `Fetch failed: ${result.error}`;
      fetchModelsBtn.disabled = false;
      fetchModelsBtn.textContent = "Fetch";
      return;
    }

    await setCachedModels(baseUrl, apiKey, result.data);
    const provider = providers.find((p) => p.id === providerSelect.value);
    applyFetchedModels(provider, result.data, null);
    modelHint.textContent = "Select a model from the list, or use Custom model to type one";
    fetchModelsBtn.disabled = false;
    fetchModelsBtn.textContent = "Fetch";
  }

  fetchModelsBtn.addEventListener("click", async () => {
    const baseUrl = baseUrlInput.value.trim();
    if (!baseUrl) {
      baseUrlHint.textContent = "Please enter a base URL first";
      return;
    }

    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      baseUrlHint.textContent = "Please enter an API key first";
      return;
    }

    await doFetchModels(baseUrl, apiKey);
  });

  apiKeyInput.addEventListener("input", updateMarkUnsaved);
  baseUrlInput.addEventListener("input", () => {
    updateMarkUnsaved();
    baseUrlHint.textContent = "Full API base URL including version path";
  });
  customModelInput.addEventListener("input", () => {
    updateMarkUnsaved();
    confidenceSection.hidden = true;
  });

  if (providers.length > 0) {
    apiKeyInput.placeholder = providers[0].keyPlaceholder;
  }
}

async function loadSettings() {
  log.info("Loading saved settings");
  const { providerId, apiKey, model, baseUrl, enabled } = await getSettings();
  log.debug("Loaded settings", {
    providerId,
    model: model || "default",
    enabled,
    hasKey: Boolean(apiKey),
  });
  providerSelect.value = providerId;
  apiKeyInput.placeholder = providers.find((p) => p.id === providerId)?.keyPlaceholder || "sk-...";

  const isGeneric = providerId === OPENAI_COMPATIBLE_ID;
  baseUrlSection.hidden = !isGeneric;
  if (isGeneric) {
    baseUrlInput.value = baseUrl || "";
  }

  if (isGeneric && baseUrl && apiKey && apiKey !== NO_API_KEY_SENTINEL) {
    const cached = await getCachedModels(baseUrl, apiKey);
    if (cached) {
      const genericProvider = providers.find((p) => p.id === OPENAI_COMPATIBLE_ID);
      applyFetchedModels(genericProvider, cached, model);
    } else {
      await populateModels(providerId, model);
      doFetchModels(baseUrl, apiKey);
    }
  } else {
    await populateModels(providerId, model);
  }

  if (apiKey && apiKey !== NO_API_KEY_SENTINEL) apiKeyInput.value = apiKey;
  enabledToggle.checked = enabled;
  showAiStatus(providerId);
  captureSavedState();
  updateMarkUnsaved();
}

saveBtn.addEventListener("click", async () => {
  const providerId = providerSelect.value;
  const model = getSelectedModel();
  let apiKey = apiKeyInput.value.trim();
  let baseUrl = providerId === OPENAI_COMPATIBLE_ID ? baseUrlInput.value.trim() : "";

  const providerInfo = providers.find((p) => p.id === providerId);

  if (providerId === OPENAI_COMPATIBLE_ID) {
    if (!baseUrl) {
      log.warn("Save aborted — no base URL");
      showStatus("Please enter a base URL", "error");
      return;
    }
    const validation = validateBaseUrl(baseUrl);
    if (validation.xss) {
      log.warn("Save aborted — XSS detected in URL");
      showStatus(validation.error, "error");
      return;
    }
    if (!validation.valid) {
      log.warn("Save aborted — invalid base URL");
      showStatus(validation.error, "error");
      return;
    }
    baseUrl = validation.sanitized;
  }

  if (providerInfo?.requiresApiKey && !apiKey) {
    log.warn("Save aborted — no API key");
    showStatus("Please enter an API key", "error");
    return;
  }

  if (!model) {
    log.warn("Save aborted — no model selected");
    showStatus("Please select or enter a model", "error");
    return;
  }

  if (providerInfo?.requiresApiKey) {
    try {
      const provider = createProvider(providerId, apiKey, model, baseUrl);
      provider.validateApiKey();
    } catch (e) {
      log.warn("Save aborted — invalid API key:", e.message);
      showStatus(e.message, "error");
      return;
    }
  }

  if (!apiKey && providerInfo && !providerInfo.requiresApiKey) {
    apiKey = NO_API_KEY_SENTINEL;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Verifying…";
  log.info("Verifying provider", { providerId, model });

  try {
    const verifyResult = await chrome.runtime.sendMessage({
      type: "VERIFY_SETTINGS",
      providerId,
      apiKey,
      model,
      baseUrl,
    });

    if (!verifyResult.success) {
      log.warn("Save aborted — provider verification failed:", verifyResult.error);
      showStatus(verifyResult.error || "Provider verification failed", "error");
      saveBtn.disabled = false;
      updateMarkUnsaved();
      return;
    }

    log.info("Provider verified, saving settings", { providerId, model });
    saveBtn.textContent = "Saving…";

    await setSettings({ providerId, model, apiKey, baseUrl });
    log.info("Settings saved successfully");

    if (baseUrl) {
      saveBaseUrlSuggestion(baseUrl).catch((e) =>
        log.warn("Failed to save URL suggestion:", e.message),
      );
      populateBaseUrlSuggestions().catch((e) =>
        log.warn("Failed to refresh suggestions:", e.message),
      );
    }

    if (verifyResult.warning) {
      showStatus(`Settings saved. ${verifyResult.warning}`, "warning");
    } else {
      showStatus("Settings saved");
    }

    captureSavedState();
    updateMarkUnsaved();
  } catch (err) {
    log.error("Save error:", err.message);
    showStatus("Failed to save settings", "error");
  } finally {
    saveBtn.disabled = false;
    updateMarkUnsaved();
  }
});

toggleVisibility.addEventListener("click", () => {
  const isPassword = apiKeyInput.type === "password";
  apiKeyInput.type = isPassword ? "text" : "password";
});

enabledToggle.addEventListener("change", async () => {
  log.info(`Extension ${enabledToggle.checked ? "enabled" : "disabled"}`);
  await setSettings({ enabled: enabledToggle.checked });
  captureSavedState();
  updateMarkUnsaved();
});

const CONFIDENCE_TIERS = [
  {
    max: 30,
    emoji: "💔",
    label: "Tentative",
    count: 1,
    cls: "grammar-instinct--tentative",
    desc: "May miss some grammar and spelling issues.",
  },
  {
    max: 60,
    emoji: "🫠",
    label: "Reliable",
    count: 2,
    cls: "grammar-instinct--reliable",
    desc: "Good at fixing most common grammar and spelling issues.",
  },
  {
    max: 85,
    emoji: "💪",
    label: "Strong",
    count: 3,
    cls: "grammar-instinct--strong",
    desc: "Consistently catches grammar and spelling issues.",
  },
  {
    max: 100,
    emoji: "👍",
    label: "Exceptional",
    count: 4,
    cls: "grammar-instinct--exceptional",
    desc: "Excellent grammar and spelling correction.",
  },
];

const SPEED_TIERS = [
  { max: 2000, label: "Fast", emoji: "\u26A1", cls: "speed--fast" },
  { max: 5000, label: "Moderate", emoji: "\uD83D\uDEB6", cls: "speed--moderate" },
  { max: Infinity, label: "Slow", emoji: "\uD83D\uDC22", cls: "speed--slow" },
];

function showSpeedInfo(responseTimeMs) {
  if (responseTimeMs == null || typeof responseTimeMs !== "number") {
    giSpeed.hidden = true;
    return;
  }

  const tier = SPEED_TIERS.find((t) => responseTimeMs <= t.max) || SPEED_TIERS[0];
  const secs = (responseTimeMs / 1000).toFixed(1);
  giSpeed.textContent = `${tier.emoji} ${tier.label} — ${secs}s`;
  giSpeed.className = `grammar-instinct__speed ${tier.cls}`;
  giSpeed.hidden = false;
}

function showConfidenceEmojis(confidence) {
  if (confidence == null || typeof confidence !== "number") {
    confidenceSection.hidden = true;
    giSpeed.hidden = true;
    return;
  }

  const pct = Math.min(100, Math.max(0, confidence));
  const tier = CONFIDENCE_TIERS.find((t) => pct <= t.max) || CONFIDENCE_TIERS[0];
  const slots = [];

  for (let i = 0; i < 4; i++) {
    const filled = i < tier.count;
    const el = document.createElement("span");
    el.className = filled ? "active" : "inactive";
    el.textContent = filled ? tier.emoji : "\u25CB";
    slots.push(el);
  }

  const emojiRow = giEmojis;
  giRow.classList.add("fade");
  giTitle.textContent = tier.label;
  giDesc.textContent = tier.desc;
  confidenceSection.className = `grammar-instinct ${tier.cls}`;

  requestAnimationFrame(() => {
    emojiRow.replaceChildren(...slots);
    giRow.classList.remove("fade");
  });

  confidenceSection.hidden = false;
}

function toggleResetCacheBtn(logLevel) {
  resetCacheBtn.classList.toggle("visible", logLevel === "debug");
}

logLevelSelect.addEventListener("change", async () => {
  const level = logLevelSelect.value;
  log.info(`Log level changed to: ${level}`);
  toggleResetCacheBtn(level);
  await setSettings({ logLevel: level });
  captureSavedState();
  updateMarkUnsaved();
});

getSettings().then(({ logLevel }) => {
  logLevelSelect.value = logLevel;
  toggleResetCacheBtn(logLevel);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "VERIFY_PROGRESS" || !saveBtn.disabled) return;
  if (msg.status === "done") {
    saveBtn.textContent = "Done \u2713";
    if (msg.confidence != null) showConfidenceEmojis(msg.confidence);
    showSpeedInfo(msg.responseTimeMs);
  } else {
    saveBtn.textContent = `Verifying (${msg.status})...`;
    confidenceSection.hidden = true;
    giSpeed.hidden = true;
  }
});

async function loadCurrentSite() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url) return;
    const url = new URL(tab.url);
    if (!["http:", "https:"].includes(url.protocol)) return;
    currentHostname = url.hostname;
    siteHost.textContent = currentHostname;
    siteSection.hidden = false;

    const { disabledSites } = await getSettings();
    siteToggle.checked = !disabledSites.includes(currentHostname);
    log.debug("Site toggle loaded", {
      currentHostname,
      disabled: !siteToggle.checked,
    });
  } catch (err) {
    log.debug("Could not detect current site:", err.message);
  }
}

siteToggle.addEventListener("change", async () => {
  if (!currentHostname) return;
  const { disabledSites } = await getSettings();
  const sites = new Set(disabledSites);

  if (siteToggle.checked) {
    sites.delete(currentHostname);
    log.info(`Enabled on ${currentHostname}`);
  } else {
    sites.add(currentHostname);
    log.info(`Disabled on ${currentHostname}`);
  }

  await setSettings({ disabledSites: [...sites] });
});

log.info("Popup opened");
(async () => {
  await populateProviders();
  loadSettings();
  loadCurrentSite();
  populateBaseUrlSuggestions();
})().catch((err) => log.error("Popup init failed:", err.message));

// ── Session Usage ──

const usageSection = document.getElementById("usage-section");
const usageStats = document.getElementById("usage-stats");

async function loadSessionUsage() {
  try {
    const data = await chrome.runtime.sendMessage({
      type: "GET_SESSION_USAGE",
    });
    if (!data || data.summary.totalChecks === 0) {
      usageSection.hidden = true;
      return;
    }

    usageSection.hidden = false;
    const s = data.summary;
    const last = data.checks[data.checks.length - 1];
    const fmt = (n) => n.toLocaleString();

    usageStats.innerHTML = `
      <div class="usage-row">
        <span class="usage-stat">
          <span class="usage-value">${fmt(s.totalChecks)}</span>
          <span class="usage-label">checks</span>
        </span>
        <span class="usage-stat">
          <span class="usage-value">${fmt(s.totalTokens)}</span>
          <span class="usage-label">total tokens</span>
        </span>
      </div>
      <div class="usage-detail">
        ${fmt(s.totalPromptTokens)} prompt + ${fmt(s.totalCompletionTokens)} completion
      </div>
      <div class="usage-last">
        Last: ${last.model} (${fmt(last.total_tokens)} tokens)
      </div>
    `;
    log.debug("Session usage loaded", s);
  } catch (err) {
    log.debug("Could not load session usage:", err.message);
    usageSection.hidden = true;
  }
}

loadSessionUsage();
