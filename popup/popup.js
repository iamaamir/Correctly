import { createProvider, getAvailableProviders } from "../providers/provider-registry.js";
import { createLogger } from "../lib/logger.js";

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

let currentHostname = null;

const CUSTOM_VALUE = "__custom__";
const NO_API_KEY_SENTINEL = "noapikeyrequired";
let providers = [];

function showStatus(message, type = "success") {
  statusMsg.textContent = message;
  statusMsg.className = `status ${type}`;
  statusMsg.hidden = false;
  setTimeout(() => {
    statusMsg.hidden = true;
  }, 2500);
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
  // getAvailableProviders() returned sync (P.models) for instant render;
  // this refreshes them from the provider API so the dropdown is up to date.
  if (provider._classRef) {
    provider.models = await provider._classRef.getModels();
  }

  // Render
  modelSelect.innerHTML = "";
  modelHint.textContent = "";
  customModelInput.value = "";
  setCustomInputVisibility(false);

  if (!provider.models) return;

  provider.models.forEach((m) => {
    const option = document.createElement("option");
    option.value = m.id;
    option.textContent = m.label;
    modelSelect.appendChild(option);
  });

  const customOption = document.createElement("option");
  customOption.value = CUSTOM_VALUE;
  customOption.textContent = "Custom model...";
  modelSelect.appendChild(customOption);

  if (selectedModel) {
    const isKnown = provider.models.some((m) => m.id === selectedModel);
    if (isKnown) {
      modelSelect.value = selectedModel;
    } else {
      modelSelect.value = CUSTOM_VALUE;
      customModelInput.value = selectedModel;
      setCustomInputVisibility(true);
    }
  } else {
    modelSelect.value = provider.defaultModel;
  }

  updateModelHint();
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
          <p class="status-error">✗ Chrome Free AI not supported on this device</p>
          <p class="status-hint">Requires macOS 13+, 22GB free space, 16GB RAM.<br>
          Ensure flags are enabled: chrome://flags/#optimization-guide-on-device-model and
          chrome://flags/#prompt-api-for-gemini-nano</p>
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
      await populateModels(provider.id, null);
      showAiStatus(provider.id);
    }
  });

  modelSelect.addEventListener("change", () => {
    log.debug(`Model changed to: ${isCustomSelected() ? "custom" : modelSelect.value}`);
    setCustomInputVisibility(isCustomSelected());
    updateModelHint();
  });

  if (providers.length > 0) {
    apiKeyInput.placeholder = providers[0].keyPlaceholder;
  }
}

async function loadSettings() {
  log.info("Loading saved settings");
  const result = await chrome.storage.local.get(["providerId", "apiKey", "model", "enabled"]);
  const providerId = result.providerId || "openai";
  log.debug("Loaded settings", {
    providerId,
    model: result.model || "default",
    enabled: result.enabled !== false,
    hasKey: Boolean(result.apiKey),
  });
  providerSelect.value = providerId;
  await populateModels(providerId, result.model);
  if (result.apiKey && result.apiKey !== NO_API_KEY_SENTINEL) apiKeyInput.value = result.apiKey;
  enabledToggle.checked = result.enabled !== false;
  showAiStatus(providerId);
}

saveBtn.addEventListener("click", async () => {
  const providerId = providerSelect.value;
  const model = getSelectedModel();
  let apiKey = apiKeyInput.value.trim();

  const providerInfo = providers.find((p) => p.id === providerId);

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
      const provider = createProvider(providerId, apiKey, model);
      provider.validateApiKey();
    } catch (e) {
      log.warn("Save aborted — invalid API key:", e.message);
      showStatus(e.message, "error");
      return;
    }
  }

  if (providerId === "chrome-free-ai" && !apiKey) {
    apiKey = NO_API_KEY_SENTINEL;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  log.info("Saving settings", { providerId, model });

  try {
    await chrome.storage.local.set({ providerId, model, apiKey });
    log.info("Settings saved successfully");
    showStatus("Settings saved");
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
  await chrome.storage.local.set({ enabled: enabledToggle.checked });
});

logLevelSelect.addEventListener("change", async () => {
  const level = logLevelSelect.value;
  log.info(`Log level changed to: ${level}`);
  await chrome.storage.local.set({ logLevel: level });
});

chrome.storage.local.get("logLevel").then(({ logLevel }) => {
  logLevelSelect.value = logLevel || "info";
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

    const { disabledSites = [] } = await chrome.storage.local.get("disabledSites");
    siteToggle.checked = !disabledSites.includes(currentHostname);
    log.debug("Site toggle loaded", { currentHostname, disabled: !siteToggle.checked });
  } catch (err) {
    log.debug("Could not detect current site:", err.message);
  }
}

siteToggle.addEventListener("change", async () => {
  if (!currentHostname) return;
  const { disabledSites = [] } = await chrome.storage.local.get("disabledSites");
  const sites = new Set(disabledSites);

  if (siteToggle.checked) {
    sites.delete(currentHostname);
    log.info(`Enabled on ${currentHostname}`);
  } else {
    sites.add(currentHostname);
    log.info(`Disabled on ${currentHostname}`);
  }

  await chrome.storage.local.set({ disabledSites: [...sites] });
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
