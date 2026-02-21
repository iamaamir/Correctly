const PREFIX = '[Correctly]';

const LEVELS = {
  debug:  { rank: 0, style: 'color: #888' },
  info:   { rank: 1, style: 'color: #2d7d46; font-weight: bold' },
  warn:   { rank: 2, style: 'color: #e65100; font-weight: bold' },
  error:  { rank: 3, style: 'color: #c62828; font-weight: bold' },
  silent: { rank: 4, style: '' },
};

export const LOG_LEVELS = Object.keys(LEVELS);

let currentRank = LEVELS.info.rank;

function loadLogLevel() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get('logLevel').then(({ logLevel }) => {
      setLogLevel(logLevel || 'info');
    }).catch(() => {});
  }
}

function listenForChanges() {
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.logLevel) {
        setLogLevel(changes.logLevel.newValue || 'info');
      }
    });
  }
}

export function setLogLevel(level) {
  const entry = LEVELS[level];
  if (!entry) return;
  currentRank = entry.rank;
}

loadLogLevel();
listenForChanges();

function shouldLog(level) {
  return LEVELS[level].rank >= currentRank;
}

/**
 * Creates a tagged logger for a specific module.
 * All logs are prefixed with [Correctly][tag] and styled for easy filtering.
 *
 * Respects `logLevel` from chrome.storage.local.
 * Levels (least → most verbose): silent, error, warn, info, debug
 *
 * Usage in DevTools console filter: "[Correctly]" to see all, "[Correctly][bg]" for background only.
 */
export function createLogger(tag) {
  const tagStr = `${PREFIX}[${tag}]`;

  return {
    debug: (...args) => { if (shouldLog('debug')) console.debug(`%c${tagStr}`, LEVELS.debug.style, ...args); },
    info:  (...args) => { if (shouldLog('info'))  console.info(`%c${tagStr}`, LEVELS.info.style, ...args); },
    warn:  (...args) => { if (shouldLog('warn'))  console.warn(`%c${tagStr}`, LEVELS.warn.style, ...args); },
    error: (...args) => { if (shouldLog('error')) console.error(`%c${tagStr}`, LEVELS.error.style, ...args); },

    time: (label) => {
      if (!shouldLog('debug')) return () => {};
      const key = `${tagStr} ${label}#${Date.now()}`;
      console.time(key);
      return () => console.timeEnd(key);
    },

    group: (label, fn) => {
      if (!shouldLog('info')) { fn(); return; }
      console.groupCollapsed(`%c${tagStr} ${label}`, LEVELS.info.style);
      try {
        fn();
      } finally {
        console.groupEnd();
      }
    },

    table: (data) => {
      if (shouldLog('debug')) console.table(data);
    },
  };
}
