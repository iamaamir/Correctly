import { createProvider, getAvailableProviders } from "../providers/provider-registry.js";
import { createLogger } from "../lib/logger.js";
import { getSettings, setSettings } from "../lib/settings.js";

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
let providers = [];
let savedState = {};

function showStatus(message, type = "success") {
  statusMsg.textContent = message;
  statusMsg.className = `status ${type}`;
  statusMsg.hidden = false;
  setTimeout(() => {
    statusMsg.hidden = true;
  }, 2500);
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
  saveBtn.className = hasUnsavedChanges() ? "btn-primary btn-unsaved" : "btn-primary";
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
    models.forEach((m) => {
      const option = document.createElement("option");
      option.value = m.id;
      option.textContent = m.label;
      modelSelect.appendChild(option);
    });
  }

  const customOption = document.createElement("option");
  customOption.value = CUSTOM_VALUE;
  customOption.textContent = "Custom model...";
  modelSelect.appendChild(customOption);

  if (selectedModel) {
    const isKnown = models && models.some((m) => m.id === selectedModel);
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
        if (!result || !result.status) {
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
  providers.forEach((p) => {
    const option = document.createElement("option");
    option.value = p.id;
    option.textContent = p.available ? p.name : `${p.name} (unavailable)`;
    providerSelect.appendChild(option);
  });

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
        baseUrlHint.textContent = "Base URL for the OpenAI-compatible API (no trailing /v1)";
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
  });

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

    fetchModelsBtn.disabled = true;
    fetchModelsBtn.textContent = "Fetching...";

    const result = await chrome.runtime.sendMessage({
      type: "FETCH_MODELS",
      baseUrl,
      apiKey,
    });

    if (result.error) {
      baseUrlHint.textContent = `Fetch failed: ${result.error}`;
      fetchModelsBtn.disabled = false;
      fetchModelsBtn.textContent = "Fetch";
      return;
    }

    const provider = providers.find((p) => p.id === providerSelect.value);
    const fetched = result.models || [];
    const limited = fetched.slice(0, 10);

    if (provider) {
      provider.models = limited;
    }

    if (fetched.length > 10) {
      baseUrlHint.textContent = `Showing 10 of ${fetched.length} models — use Custom model for others`;
    } else {
      baseUrlHint.textContent = `${fetched.length} model(s) available`;
    }

    renderModelDropdown(limited, limited[0]?.id, provider?.defaultModel);
    modelHint.textContent = "Select a model from the list, or use Custom model to type one";
    fetchModelsBtn.disabled = false;
    fetchModelsBtn.textContent = "Fetch";
  });

  apiKeyInput.addEventListener("input", updateMarkUnsaved);
  baseUrlInput.addEventListener("input", updateMarkUnsaved);
  customModelInput.addEventListener("input", updateMarkUnsaved);

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

  await populateModels(providerId, model);
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
  const baseUrl = providerId === OPENAI_COMPATIBLE_ID ? baseUrlInput.value.trim() : "";

  const providerInfo = providers.find((p) => p.id === providerId);

  if (providerId === OPENAI_COMPATIBLE_ID && !baseUrl) {
    log.warn("Save aborted — no base URL");
    showStatus("Please enter a base URL", "error");
    return;
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
      saveBtn.textContent = "Save";
      return;
    }

    log.info("Provider verified, saving settings", { providerId, model });
    saveBtn.textContent = "Saving…";

    await setSettings({ providerId, model, apiKey, baseUrl });
    log.info("Settings saved successfully");
    showStatus("Settings saved");
    captureSavedState();
    updateMarkUnsaved();
  } catch (err) {
    log.error("Save error:", err.message);
    showStatus("Failed to save settings", "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
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

logLevelSelect.addEventListener("change", async () => {
  const level = logLevelSelect.value;
  log.info(`Log level changed to: ${level}`);
  await setSettings({ logLevel: level });
  captureSavedState();
  updateMarkUnsaved();
});

getSettings().then(({ logLevel }) => {
  logLevelSelect.value = logLevel;
});

async function loadCurrentSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;
    const url = new URL(tab.url);
    if (!["http:", "https:"].includes(url.protocol)) return;
    currentHostname = url.hostname;
    siteHost.textContent = currentHostname;
    siteSection.hidden = false;

    const { disabledSites } = await getSettings();
    siteToggle.checked = !disabledSites.includes(currentHostname);
    log.debug("Site toggle loaded", { currentHostname, disabled: !siteToggle.checked });
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
})().catch((err) => log.error("Popup init failed:", err.message));

// ── Session Usage ──

const usageSection = document.getElementById("usage-section");
const usageStats = document.getElementById("usage-stats");

async function loadSessionUsage() {
  try {
    const data = await chrome.runtime.sendMessage({ type: "GET_SESSION_USAGE" });
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
