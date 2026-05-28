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
const saveState = document.getElementById("save-state");
const statusMsg = document.getElementById("status-msg");
const toggleVisibility = document.getElementById("toggle-visibility");
const enabledToggle = document.getElementById("enabled-toggle");
const siteSection = document.getElementById("site-section");
const siteToggle = document.getElementById("site-toggle");
const siteHost = document.getElementById("site-host");
const logLevelSelect = document.getElementById("log-level");
const resetCacheBtn = document.getElementById("reset-cache-btn");
const confidenceSection = document.getElementById("verify-confidence");
const qualityMeter = document.getElementById("quality-meter");
const qualityTitle = document.getElementById("quality-title");
const qualityDesc = document.getElementById("quality-desc");
const qualitySpeed = document.getElementById("quality-speed");
const aiStatusSection = document.getElementById("ai-status-section");
const aiStatusContent = document.getElementById("ai-status-content");
const baseUrlSection = document.getElementById("base-url-section");
const baseUrlInput = document.getElementById("base-url");
const baseUrlHint = document.getElementById("base-url-hint");

let currentHostname = null;

const CUSTOM_VALUE = "__custom__";
const NO_API_KEY_SENTINEL = "noapikeyrequired";
const OPENAI_COMPATIBLE_ID = "openai-compatible";
const SAVED_URLS_KEY = "savedBaseUrls";
const MODEL_FETCH_DEBOUNCE_MS = 1200;
const MODEL_FETCH_RETRY_COOLDOWN_MS = 30000;
let providers = [];
let savedState = null;
let modelFetchTimer = null;
let modelFetchRequestId = 0;
let loadedModelsKey = "";
let activeModelFetch = null;
let activeModelFetchKey = "";
let lastModelFetchFailure = { key: "", timestamp: 0 };

const MODELS_CACHE_KEY = "fetchedModelsCache";
const MODELS_CACHE_TTL = 5 * 60 * 1000;
const MODEL_CACHE_MEM = new Map();

async function getCachedModels(baseUrl, apiKey) {
  const cacheKey = `${baseUrl}|${apiKey || ""}`;
  const mem = MODEL_CACHE_MEM.get(cacheKey);
  if (mem && Date.now() - mem.timestamp < MODELS_CACHE_TTL) return mem.models;
  const data = await chrome.storage.session.get(MODELS_CACHE_KEY);
  const storage = data[MODELS_CACHE_KEY];
  if (storage && storage.cacheKey === cacheKey && Date.now() - storage.timestamp < MODELS_CACHE_TTL) {
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

function getModelsCacheKey(baseUrl, apiKey) {
  return `${baseUrl}|${apiKey || ""}`;
}

function applyFetchedModels(provider, models, selectedModel) {
  const fetched = models || [];
  const limited = fetched.slice(0, 20);
  if (provider) provider.models = limited;
  renderModelDropdown(limited, selectedModel || limited[0]?.id, provider?.defaultModel);
  highlightModelSelect(fetched.length > 0);
  baseUrlHint.textContent = fetched.length > 0 ? "Models loaded" : "No models found for this endpoint";
}

function highlightModelSelect(shouldHighlight) {
  modelSelect.classList.remove("model-select--loaded");
  if (!shouldHighlight) return;

  requestAnimationFrame(() => {
    modelSelect.classList.add("model-select--loaded");
  });

  setTimeout(() => {
    modelSelect.classList.remove("model-select--loaded");
  }, 1800);
}

async function doFetchModels(baseUrl, apiKey, selectedModel = null) {
  const cacheKey = getModelsCacheKey(baseUrl, apiKey);
  if (activeModelFetch && activeModelFetchKey === cacheKey) {
    return await activeModelFetch;
  }

  const now = Date.now();
  if (lastModelFetchFailure.key === cacheKey && now - lastModelFetchFailure.timestamp < MODEL_FETCH_RETRY_COOLDOWN_MS) {
    baseUrlHint.textContent = "Model loading paused after a failed attempt. Save will retry.";
    return false;
  }

  const requestId = ++modelFetchRequestId;
  const cached = await getCachedModels(baseUrl, apiKey);
  if (requestId !== modelFetchRequestId) return false;

  if (cached) {
    log.debug("Using cached models for", baseUrl);
    const provider = providers.find((p) => p.id === providerSelect.value);
    applyFetchedModels(provider, cached, selectedModel);
    loadedModelsKey = cacheKey;
    return true;
  }

  baseUrlHint.textContent = "Loading models...";
  modelSelect.classList.remove("model-select--loaded");

  activeModelFetchKey = cacheKey;
  activeModelFetch = (async () => {
    const result = await chrome.runtime.sendMessage({
      type: "FETCH_MODELS",
      baseUrl,
      apiKey,
    });

    if (requestId !== modelFetchRequestId) return false;

    if (!result.success) {
      lastModelFetchFailure = { key: cacheKey, timestamp: Date.now() };
      baseUrlHint.textContent = `Could not load models: ${result.error}`;
      return false;
    }

    await setCachedModels(baseUrl, apiKey, result.data);
    const provider = providers.find((p) => p.id === providerSelect.value);
    applyFetchedModels(provider, result.data, selectedModel);
    loadedModelsKey = cacheKey;
    lastModelFetchFailure = { key: "", timestamp: 0 };
    modelHint.textContent = "Models loaded. Choose one from the list, or select Custom model.";
    return true;
  })();

  try {
    return await activeModelFetch;
  } finally {
    if (activeModelFetchKey === cacheKey) {
      activeModelFetch = null;
      activeModelFetchKey = "";
    }
  }
}

function scheduleModelFetch() {
  if (modelFetchTimer) clearTimeout(modelFetchTimer);
  if (providerSelect.value !== OPENAI_COMPATIBLE_ID) return;

  const baseUrl = baseUrlInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  modelSelect.classList.remove("model-select--loaded");

  if (!baseUrl) {
    baseUrlHint.textContent = "Models load after URL and API key are entered";
    modelHint.textContent = "Enter endpoint details to load available models";
    loadedModelsKey = "";
    return;
  }

  const validation = validateBaseUrl(baseUrl);
  if (!validation.valid) {
    baseUrlHint.textContent = "Enter a valid base URL to load models";
    modelHint.textContent = "Enter endpoint details to load available models";
    loadedModelsKey = "";
    return;
  }

  if (!apiKey) {
    baseUrlHint.textContent = "Enter an API key to load models";
    modelHint.textContent = "Enter endpoint details to load available models";
    loadedModelsKey = "";
    return;
  }

  loadedModelsKey = "";
  const cacheKey = getModelsCacheKey(validation.sanitized, apiKey);
  if (lastModelFetchFailure.key === cacheKey) {
    const elapsed = Date.now() - lastModelFetchFailure.timestamp;
    if (elapsed < MODEL_FETCH_RETRY_COOLDOWN_MS) {
      baseUrlHint.textContent = "Model loading paused after a failed attempt. Save will retry.";
      modelHint.textContent = "Select Custom model to type a model ID.";
      return;
    }
  }

  baseUrlHint.textContent = "Models load automatically after you stop typing";
  modelHint.textContent = "Waiting for endpoint details to settle...";
  modelFetchTimer = setTimeout(() => {
    doFetchModels(validation.sanitized, apiKey).catch((err) => {
      baseUrlHint.textContent = `Could not load models: ${err.message}`;
    });
  }, MODEL_FETCH_DEBOUNCE_MS);
}

async function ensureModelsLoaded(baseUrl, apiKey, selectedModel = null) {
  if (modelFetchTimer) clearTimeout(modelFetchTimer);
  if (loadedModelsKey === getModelsCacheKey(baseUrl, apiKey)) return;
  lastModelFetchFailure = { key: "", timestamp: 0 };
  const loaded = await doFetchModels(baseUrl, apiKey, selectedModel);
  if (!loaded) throw new Error("Could not load models");
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
  datalist.replaceChildren(
    ...Array.from(SAVED_URLS_SET).map((url) => {
      const option = document.createElement("option");
      option.value = url;
      return option;
    }),
  );
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
let statusExitTimer;
const STATUS_EXIT_DURATION_MS = 250;

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

  clearTimeout(statusTimer);
  clearTimeout(statusExitTimer);
  statusMsg.classList.remove("status--leaving");

  const alreadyVisible = !statusMsg.hidden;

  if (alreadyVisible && document.startViewTransition) {
    try {
      document.startViewTransition(() => {
        statusMsg.textContent = message;
        statusMsg.className = `status ${type}`;
      });
    } catch {
      statusMsg.textContent = message;
      statusMsg.className = `status ${type}`;
    }
  } else {
    statusMsg.textContent = message;
    statusMsg.className = `status ${type}`;
    statusMsg.hidden = false;
  }

  const baseDuration = DURATIONS[type] ?? DURATIONS.info;

  const readingTime = message.length * MS_PER_CHARACTER;

  const duration = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, baseDuration + readingTime));

  statusTimer = setTimeout(() => {
    statusMsg.classList.add("status--leaving");
    statusExitTimer = setTimeout(() => {
      statusMsg.hidden = true;
      statusMsg.classList.remove("status--leaving");
    }, STATUS_EXIT_DURATION_MS);
  }, duration);

  statusMsg.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function captureSavedState() {
  savedState = {
    providerId: providerSelect.value,
    model: getSelectedModel(),
    apiKey: apiKeyInput.value.trim(),
    baseUrl: providerSelect.value === OPENAI_COMPATIBLE_ID ? baseUrlInput.value.trim() : "",
  };
}

function hasUnsavedChanges() {
  if (!savedState) return false;
  return (
    savedState.providerId !== providerSelect.value ||
    savedState.model !== getSelectedModel() ||
    savedState.apiKey !== apiKeyInput.value.trim() ||
    savedState.baseUrl !== (providerSelect.value === OPENAI_COMPATIBLE_ID ? baseUrlInput.value.trim() : "")
  );
}

function updateMarkUnsaved() {
  const unsaved = hasUnsavedChanges();
  saveState.hidden = !unsaved;
  saveState.textContent = unsaved ? "Unsaved changes" : "";
  if (saveBtn.disabled) return;
  saveBtn.className = "btn-primary";
  saveBtn.textContent = "Save";
}

function clearCompatibilityScore() {
  confidenceSection.hidden = true;
  qualitySpeed.hidden = true;
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
  modelSelect.replaceChildren();
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
  modelSelect.replaceChildren();
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
    renderAiStatus("info", "Checking model status…");

    chrome.runtime
      .sendMessage({ type: "GET_AI_STATUS", providerId })
      .then((result) => {
        if (!result?.status) {
          renderAiStatus("error", "Could not check model status");
          return;
        }

        const s = result.status;

        if (s === "available") {
          renderAiStatus("ready", "Local Gemini Nano ready to use");
        } else if (s === "downloadable") {
          renderAiStatus("info", "Gemini Nano needs to be downloaded (~22GB free space required)", {
            actionLabel: "Download Gemini Nano",
            onAction: () => {
              chrome.runtime.sendMessage({ type: "TRIGGER_MODEL_DOWNLOAD" });
              renderAiStatus("info", "Download started. Check back later.");
            },
          });
        } else if (s === "downloading") {
          renderAiStatus("info", "Model download in progress. Check back later.");
        } else {
          renderAiStatus("error", "Chrome Free AI is not supported in this browser", {
            hint: "This browser does not currently support the required AI capabilities. Try a supported version of Google Chrome.",
          });
        }
      })
      .catch((err) => {
        log.error("GET_AI_STATUS failed:", err.message);
        renderAiStatus("error", "Error checking model status");
      });
    return;
  }

  // Other providers: show availability status
  aiStatusSection.hidden = provider.available;
  if (!provider.available) {
    const hint = provider._classRef.availabilityHint;
    renderAiStatus("error", `${provider.name} is not available`, { hint });
  }
}

function renderAiStatus(type, message, { hint, actionLabel, onAction } = {}) {
  const messageEl = document.createElement("p");
  messageEl.className = `status-${type}`;
  messageEl.textContent = message;

  const children = [messageEl];
  if (hint) {
    const hintEl = document.createElement("p");
    hintEl.className = "status-hint";
    hintEl.textContent = hint;
    children.push(hintEl);
  }
  if (actionLabel) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-primary";
    button.textContent = actionLabel;
    button.addEventListener("click", onAction);
    children.push(button);
  }

  aiStatusContent.replaceChildren(...children);
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
      clearCompatibilityScore();
      apiKeyInput.placeholder = provider.keyPlaceholder;
      const isGeneric = provider.id === OPENAI_COMPATIBLE_ID;
      baseUrlSection.hidden = !isGeneric;
      if (isGeneric) {
        const { baseUrl } = await getSettings();
        baseUrlInput.value = baseUrl || "";
        baseUrlHint.textContent = "Models load after URL and API key are entered";
      }
      await populateModels(provider.id, null);
      if (isGeneric) scheduleModelFetch();
      showAiStatus(provider.id);
      updateMarkUnsaved();
    }
  });

  modelSelect.addEventListener("change", () => {
    log.debug(`Model changed to: ${isCustomSelected() ? "custom" : modelSelect.value}`);
    clearCompatibilityScore();
    setCustomInputVisibility(isCustomSelected());
    updateModelHint();
    updateMarkUnsaved();
  });

  document.getElementById("reset-cache-btn").addEventListener("click", async () => {
    await chrome.storage.local.remove("modelLevelCache");
    showStatus("Model cache cleared", "info");
    log.info("Model level cache cleared");
  });

  apiKeyInput.addEventListener("input", () => {
    clearCompatibilityScore();
    updateMarkUnsaved();
    scheduleModelFetch();
  });
  baseUrlInput.addEventListener("input", () => {
    clearCompatibilityScore();
    updateMarkUnsaved();
    scheduleModelFetch();
  });
  customModelInput.addEventListener("input", () => {
    clearCompatibilityScore();
    updateMarkUnsaved();
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
      doFetchModels(baseUrl, apiKey, model).catch((err) => {
        baseUrlHint.textContent = `Could not load models: ${err.message}`;
      });
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
  let model = getSelectedModel();
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

  if (providerId === OPENAI_COMPATIBLE_ID && !isCustomSelected()) {
    try {
      saveBtn.disabled = true;
      saveBtn.setAttribute("aria-busy", "true");
      saveBtn.textContent = "Loading models...";
      await ensureModelsLoaded(baseUrl, apiKey, model);
      model = getSelectedModel();
    } catch (err) {
      log.warn("Model loading failed before save:", err.message);
      showStatus("Could not load models. Select Custom model and enter a model ID.", "error");
      saveBtn.disabled = false;
      saveBtn.removeAttribute("aria-busy");
      updateMarkUnsaved();
      return;
    }
  }

  if (!model) {
    log.warn("Save aborted — no model selected");
    showStatus("Please select or enter a model", "error");
    saveBtn.disabled = false;
    saveBtn.removeAttribute("aria-busy");
    updateMarkUnsaved();
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
  saveBtn.setAttribute("aria-busy", "true");
  saveBtn.className = "btn-primary";
  saveBtn.textContent = "Verifying…";
  clearCompatibilityScore();
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
      saveBtn.removeAttribute("aria-busy");
      updateMarkUnsaved();
      return;
    }

    log.info("Provider verified, saving settings", { providerId, model });
    saveBtn.textContent = "Saving…";
    if (verifyResult.confidence != null) showCompatibilityScore(verifyResult.confidence, verifyResult.level);
    showSpeedInfo(verifyResult.responseTimeMs);

    await setSettings({ providerId, model, apiKey, baseUrl });
    log.info("Settings saved successfully");

    if (baseUrl) {
      saveBaseUrlSuggestion(baseUrl).catch((e) => log.warn("Failed to save URL suggestion:", e.message));
      populateBaseUrlSuggestions().catch((e) => log.warn("Failed to refresh suggestions:", e.message));
    }

    showStatus("Settings saved");

    captureSavedState();
    updateMarkUnsaved();
  } catch (err) {
    log.error("Save error:", err.message);
    showStatus("Failed to save settings", "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.removeAttribute("aria-busy");
    updateMarkUnsaved();
  }
});

toggleVisibility.addEventListener("click", () => {
  const isPassword = apiKeyInput.type === "password";
  apiKeyInput.type = isPassword ? "text" : "password";
  toggleVisibility.setAttribute("aria-pressed", String(isPassword));
  toggleVisibility.setAttribute("aria-label", isPassword ? "Hide API key" : "Show API key");
});

enabledToggle.addEventListener("change", async () => {
  log.info(`Extension ${enabledToggle.checked ? "enabled" : "disabled"}`);
  await setSettings({ enabled: enabledToggle.checked });
  updateMarkUnsaved();
});

const COMPATIBILITY_TIERS = [
  {
    max: 15,
    label: "Not ready",
    count: 1,
    cls: "model-quality--limited",
    desc: "This model did not pass the test. Try another model or provider.",
  },
  {
    max: 30,
    label: "Basic",
    count: 1,
    cls: "model-quality--limited",
    desc: "This model can help, but results may be less precise.",
  },
  {
    max: 60,
    label: "Good",
    count: 2,
    cls: "model-quality--usable",
    desc: "This model can handle everyday grammar checks.",
  },
  {
    max: 85,
    label: "Great",
    count: 3,
    cls: "model-quality--strong",
    desc: "This model gives clear, reliable suggestions.",
  },
  {
    max: 100,
    label: "Excellent",
    count: 4,
    cls: "model-quality--excellent",
    desc: "This model is a strong fit for detailed writing help.",
  },
];

const SPEED_TIERS = [
  { max: 2000, label: "Fast", cls: "speed--fast" },
  { max: 5000, label: "Moderate", cls: "speed--moderate" },
  { max: Infinity, label: "Slow", cls: "speed--slow" },
];

function showSpeedInfo(responseTimeMs) {
  if (responseTimeMs == null || typeof responseTimeMs !== "number") {
    qualitySpeed.hidden = true;
    return;
  }

  const tier = SPEED_TIERS.find((t) => responseTimeMs <= t.max) || SPEED_TIERS[0];
  const secs = (responseTimeMs / 1000).toFixed(1);
  qualitySpeed.textContent = `${tier.label} response, ${secs}s`;
  qualitySpeed.className = `model-quality__speed ${tier.cls}`;
  qualitySpeed.hidden = false;
}

function showCompatibilityScore(confidence, level = null) {
  if (confidence == null || typeof confidence !== "number") {
    confidenceSection.hidden = true;
    qualitySpeed.hidden = true;
    return;
  }

  const pct = normalizeCompatibilityScore(confidence);
  const tier =
    level >= 3
      ? {
          label: "Good",
          count: 2,
          cls: "model-quality--usable",
          desc: "This model can fix your text, but suggestions may be less detailed.",
        }
      : COMPATIBILITY_TIERS.find((t) => pct <= t.max) || COMPATIBILITY_TIERS[0];
  const segments = [];

  for (let i = 0; i < 4; i++) {
    const filled = i < tier.count;
    const el = document.createElement("span");
    el.className = filled ? "active" : "inactive";
    segments.push(el);
  }

  qualityTitle.textContent = `${tier.label} (${pct}/100)`;
  qualityDesc.textContent = tier.desc;
  confidenceSection.className = `model-quality ${tier.cls}`;

  const alreadyVisible = !confidenceSection.hidden;
  const update = () => qualityMeter.replaceChildren(...segments);

  if (alreadyVisible && document.startViewTransition) {
    try {
      document.startViewTransition(update);
    } catch {
      update();
    }
  } else {
    update();
    confidenceSection.hidden = false;
  }
}

function normalizeCompatibilityScore(confidence) {
  const score = Number.isFinite(confidence) ? confidence : 0;
  if (score > 0 && score <= 10) return Math.round(score * 10);
  return Math.round(Math.min(100, Math.max(0, score)));
}

function toggleResetCacheBtn(logLevel) {
  resetCacheBtn.classList.toggle("visible", logLevel === "debug");
}

logLevelSelect.addEventListener("change", async () => {
  const level = logLevelSelect.value;
  log.info(`Log level changed to: ${level}`);
  toggleResetCacheBtn(level);
  await setSettings({ logLevel: level });
  updateMarkUnsaved();
});

getSettings().then(({ logLevel }) => {
  logLevelSelect.value = logLevel;
  toggleResetCacheBtn(logLevel);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "VERIFY_PROGRESS" || !saveBtn.disabled) return;
  if (msg.status === "done") {
    if (msg.confidence != null) showCompatibilityScore(msg.confidence, msg.level);
    showSpeedInfo(msg.responseTimeMs);
  } else {
    confidenceSection.hidden = true;
    qualitySpeed.hidden = true;
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

    const usageRow = document.createElement("div");
    usageRow.className = "usage-row";
    usageRow.append(createUsageStat(fmt(s.totalChecks), "checks"), createUsageStat(fmt(s.totalTokens), "total tokens"));

    const detail = document.createElement("div");
    detail.className = "usage-detail";
    detail.textContent = `${fmt(s.totalPromptTokens)} prompt + ${fmt(s.totalCompletionTokens)} completion`;

    const lastRow = document.createElement("div");
    lastRow.className = "usage-last";
    lastRow.textContent = `Last: ${last.model} (${fmt(last.total_tokens)} tokens)`;
    usageStats.replaceChildren(usageRow, detail, lastRow);
    log.debug("Session usage loaded", s);
  } catch (err) {
    log.debug("Could not load session usage:", err.message);
    usageSection.hidden = true;
  }
}

function createUsageStat(value, label) {
  const stat = document.createElement("span");
  stat.className = "usage-stat";

  const valueEl = document.createElement("span");
  valueEl.className = "usage-value";
  valueEl.textContent = value;

  const labelEl = document.createElement("span");
  labelEl.className = "usage-label";
  labelEl.textContent = label;

  stat.append(valueEl, labelEl);
  return stat;
}

loadSessionUsage();
