import { createProvider } from '../providers/provider-registry.js';
import { createLogger } from '../lib/logger.js';
import { BADGE_DURATION_ISSUES, BADGE_DURATION_OK, BADGE_DURATION_ERROR } from '../lib/config.js';

const log = createLogger('bg');

const TOKEN_USAGE_KEY = 'sessionTokenUsage';
const DEFAULT_USAGE = {
  checks: [],
  summary: {
    totalChecks: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
  },
};

log.info('Service worker started');

function updateBadge(tabId, state) {
  const badges = {
    ready:    { text: '',   bg: '#2d7d46' },
    checking: { text: '...', bg: '#ff9800' },
    found:   { text: '!',   bg: '#c62828' },
    ok:      { text: '✓',   bg: '#2d7d46' },
    off:     { text: 'OFF', bg: '#999'    },
    nokey:   { text: '?',   bg: '#e65100' },
    error:   { text: '✗',   bg: '#c62828' },
  };
  const badge = badges[state] || badges.ready;
  const opts = tabId ? { tabId } : {};
  log.debug(`Badge → ${state}${tabId ? ` (tab ${tabId})` : ' (global)'}`);
  chrome.action.setBadgeText({ text: badge.text, ...opts });
  chrome.action.setBadgeBackgroundColor({ color: badge.bg, ...opts });
}

chrome.storage.local.get(['apiKey', 'enabled']).then(({ apiKey, enabled }) => {
  if (!apiKey) updateBadge(null, 'nokey');
  else if (enabled === false) updateBadge(null, 'off');
  else updateBadge(null, 'ready');
});

let cachedProvider = null;
let cachedProviderKey = '';

function providerCacheKey(providerId, apiKey, model) {
  return `${providerId}|${apiKey}|${model}`;
}

function getOrCreateProvider(providerId, apiKey, model) {
  const key = providerCacheKey(providerId, apiKey, model);
  if (cachedProvider && cachedProviderKey === key) {
    log.debug('Reusing cached provider instance');
    return cachedProvider;
  }
  log.debug('Creating new provider instance (settings changed)');
  cachedProvider = createProvider(providerId, apiKey, model);
  cachedProviderKey = key;
  return cachedProvider;
}

chrome.storage.onChanged.addListener((changes) => {
  log.debug('Storage changed:', Object.keys(changes));

  if (changes.providerId || changes.apiKey || changes.model) {
    cachedProvider = null;
    cachedProviderKey = '';
    chrome.storage.session.remove(TOKEN_USAGE_KEY);
    log.debug('Provider cache invalidated — token usage cleared');
  }

  chrome.storage.local.get(['apiKey', 'enabled']).then(({ apiKey, enabled }) => {
    if (!apiKey) updateBadge(null, 'nokey');
    else if (enabled === false) updateBadge(null, 'off');
    else updateBadge(null, 'ready');
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabInfo = sender.tab ? `tab:${sender.tab.id} ${sender.tab.url}` : 'popup';

  if (message.type === 'CHECK_GRAMMAR') {
    const tabId = sender.tab?.id;
    log.info(`CHECK_GRAMMAR request from ${tabInfo}`, { textLength: message.text?.length });
    const endTimer = log.time('grammar-check');

    updateBadge(tabId, 'checking');

    handleGrammarCheck(message.text)
      .then(result => {
        endTimer();
        const hasIssues = result.changes?.length > 0;
        updateBadge(tabId, hasIssues ? 'found' : 'ok');
        setTimeout(() => updateBadge(tabId, 'ready'), hasIssues ? BADGE_DURATION_ISSUES : BADGE_DURATION_OK);
        log.group('CHECK_GRAMMAR result', () => {
          log.info(`Changes found: ${result.changes?.length || 0}`);
          if (result.changes?.length > 0) {
            log.table(result.changes);
          }
        });
        sendResponse({ success: true, data: result });
      })
      .catch(err => {
        endTimer();
        updateBadge(tabId, 'error');
        setTimeout(() => updateBadge(tabId, 'ready'), BADGE_DURATION_ERROR);
        log.error('CHECK_GRAMMAR failed:', err.message);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'VERIFY_SETTINGS') {
    log.info(`VERIFY_SETTINGS request from ${tabInfo}`, { providerId: message.providerId, model: message.model });
    verifySettings(message.providerId, message.apiKey, message.model)
      .then(result => {
        log.info('Verification result:', result);
        sendResponse(result);
      })
      .catch(err => {
        log.error('VERIFY_SETTINGS failed:', err.message);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (message.type === 'GET_STATUS') {
    log.debug(`GET_STATUS request from ${tabInfo}`);
    getExtensionStatus()
      .then(status => {
        log.debug('Status:', status);
        sendResponse(status);
      })
      .catch((err) => {
        log.error('GET_STATUS failed:', err.message);
        sendResponse({ enabled: false, configured: false });
      });
    return true;
  }

  if (message.type === 'GET_SESSION_USAGE') {
    log.debug(`GET_SESSION_USAGE request from ${tabInfo}`);
    chrome.storage.session.get([TOKEN_USAGE_KEY])
      .then(data => {
        sendResponse(data[TOKEN_USAGE_KEY] || { checks: [], summary: { ...DEFAULT_USAGE.summary } });
      })
      .catch((err) => {
        log.error('GET_SESSION_USAGE failed:', err.message);
        sendResponse({ checks: [], summary: { ...DEFAULT_USAGE.summary } });
      });
    return true;
  }

  log.warn('Unknown message type:', message.type);
});

async function handleGrammarCheck(text) {
  const { providerId, apiKey, model, enabled } = await chrome.storage.local.get([
    'providerId', 'apiKey', 'model', 'enabled'
  ]);

  log.debug('Settings loaded', { providerId: providerId || 'openai', model: model || 'default', enabled, hasKey: Boolean(apiKey) });

  if (enabled === false) {
    throw new Error('Correctly is disabled');
  }

  if (!apiKey) {
    throw new Error('No API key configured. Click the Correctly icon to set one up.');
  }

  const provider = getOrCreateProvider(providerId || 'openai', apiKey, model);
  log.info(`Using provider: ${provider.providerName}, model: ${provider.model}`);

  const result = await provider.correctGrammar(text);

  if (result.usage) {
    await persistTokenUsage({
      provider: provider.providerId,
      model: provider.model,
      prompt_tokens: result.usage.prompt_tokens || 0,
      completion_tokens: result.usage.completion_tokens || 0,
      total_tokens: result.usage.total_tokens || 0,
      timestamp: Date.now(),
    });
  }

  return { corrected: result.corrected, changes: result.changes };
}

async function persistTokenUsage(record) {
  try {
    const data = await chrome.storage.session.get([TOKEN_USAGE_KEY]);
    const current = data[TOKEN_USAGE_KEY] || { checks: [], summary: { ...DEFAULT_USAGE.summary } };

    current.checks.push(record);
    current.summary.totalChecks++;
    current.summary.totalPromptTokens += record.prompt_tokens;
    current.summary.totalCompletionTokens += record.completion_tokens;
    current.summary.totalTokens += record.total_tokens;

    await chrome.storage.session.set({ [TOKEN_USAGE_KEY]: current });
    log.debug(`Token usage persisted — ${record.total_tokens} total tokens (${current.summary.totalChecks} checks)`);
  } catch (err) {
    log.error('Failed to persist token usage:', err.message);
  }
}

async function verifySettings(providerId, apiKey, model) {
  try {
    const provider = createProvider(providerId || 'openai', apiKey, model);
    const result = await provider.correctGrammar('This is a test.');
    if (result && typeof result.corrected === 'string') {
      return { success: true };
    }
    return { success: false, error: 'Unexpected response from provider' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getExtensionStatus() {
  const { apiKey, enabled } = await chrome.storage.local.get(['apiKey', 'enabled']);
  return {
    enabled: enabled !== false,
    configured: Boolean(apiKey)
  };
}
