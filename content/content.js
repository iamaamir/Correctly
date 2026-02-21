(() => {
  // Inline logger for content script (can't use ES module imports)
  const LOG_PREFIX = '[Correctly][content]';
  const LOG_STYLES = {
    debug: 'color: #888',
    info:  'color: #2d7d46; font-weight: bold',
    warn:  'color: #e65100; font-weight: bold',
    error: 'color: #c62828; font-weight: bold',
  };
  const LOG_RANKS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
  let logRank = LOG_RANKS.info;

  chrome.storage.local.get('logLevel').then(({ logLevel }) => {
    if (logLevel && LOG_RANKS[logLevel] !== undefined) logRank = LOG_RANKS[logLevel];
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.logLevel) {
      const level = changes.logLevel.newValue || 'info';
      if (LOG_RANKS[level] !== undefined) logRank = LOG_RANKS[level];
    }
  });

  const log = {
    debug: (...args) => { if (LOG_RANKS.debug >= logRank) console.debug(`%c${LOG_PREFIX}`, LOG_STYLES.debug, ...args); },
    info:  (...args) => { if (LOG_RANKS.info  >= logRank) console.info(`%c${LOG_PREFIX}`, LOG_STYLES.info, ...args); },
    warn:  (...args) => { if (LOG_RANKS.warn  >= logRank) console.warn(`%c${LOG_PREFIX}`, LOG_STYLES.warn, ...args); },
    error: (...args) => { if (LOG_RANKS.error >= logRank) console.error(`%c${LOG_PREFIX}`, LOG_STYLES.error, ...args); },
    time:  (label) => {
      if (LOG_RANKS.debug < logRank) return () => {};
      const k = `${LOG_PREFIX} ${label}#${Date.now()}`; console.time(k); return () => console.timeEnd(k);
    },
  };

  const DEBOUNCE_MS = 1500;
  const MIN_TEXT_LENGTH = 10;

  let debounceTimer = null;
  let activeElement = null;
  let tooltipEl = null;
  let currentCorrection = null;
  let applyingCorrection = false;
  let dismissedElement = null;

  // Input types that contain prose and should be grammar-checked
  const PROSE_INPUT_TYPES = new Set(['text', 'search', 'email']);

  // Input types that should never be grammar-checked
  const EXCLUDED_INPUT_TYPES = new Set([
    'password', 'number', 'tel', 'url', 'date', 'datetime-local',
    'time', 'month', 'week', 'color', 'range', 'file', 'hidden',
  ]);

  // inputmode values that signal non-prose input
  const EXCLUDED_INPUTMODES = new Set([
    'numeric', 'decimal', 'tel', 'none',
  ]);

  // autocomplete values that indicate sensitive or non-prose fields
  const EXCLUDED_AUTOCOMPLETE = new Set([
    'cc-number', 'cc-exp', 'cc-csc', 'cc-type',
    'tel', 'tel-national', 'tel-country-code',
    'one-time-code', 'postal-code', 'bday',
  ]);

  // ARIA roles where grammar checking would be inappropriate
  const EXCLUDED_ROLES = new Set([
    'spinbutton', 'slider', 'switch', 'combobox', 'listbox', 'menu',
  ]);

  /**
   * Determines if an element should be grammar-checked.
   * Respects HTML standards, ARIA, de facto industry attributes (Grammarly),
   * and our own data-correctly attribute.
   *
   * Returns { check: boolean, reason: string } so decisions can be logged.
   */
  function shouldCheckElement(el) {
    if (!el) return { check: false, reason: 'null element' };

    // ── 1. Our own override (highest priority) ──
    const correctly = getInheritedAttr(el, 'data-correctly');
    if (correctly === 'false') return { check: false, reason: 'data-correctly="false"' };
    if (correctly === 'true') return { check: true, reason: 'data-correctly="true" (forced)' };

    // ── 2. Basic element eligibility ──
    const tag = el.tagName;
    let eligible = false;

    if (tag === 'TEXTAREA') {
      eligible = true;
    } else if (tag === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      if (PROSE_INPUT_TYPES.has(type)) {
        eligible = true;
      } else if (EXCLUDED_INPUT_TYPES.has(type)) {
        return { check: false, reason: `input type="${type}" excluded` };
      }
    } else if (el.isContentEditable) {
      eligible = true;
    }

    if (!eligible) return { check: false, reason: 'not an editable prose element' };

    // ── 3. Disabled / readonly state ──
    if (el.disabled) return { check: false, reason: 'element is disabled' };
    if (el.readOnly) return { check: false, reason: 'element is readonly' };
    if (el.getAttribute('aria-disabled') === 'true') return { check: false, reason: 'aria-disabled="true"' };
    if (el.getAttribute('aria-readonly') === 'true') return { check: false, reason: 'aria-readonly="true"' };

    // ── 4. HTML spellcheck attribute (standard) ──
    const spellcheck = getInheritedAttr(el, 'spellcheck');
    if (spellcheck === 'false') return { check: false, reason: 'spellcheck="false"' };

    // ── 5. inputmode (non-prose keyboards) ──
    const inputmode = (el.getAttribute('inputmode') || '').toLowerCase();
    if (EXCLUDED_INPUTMODES.has(inputmode)) return { check: false, reason: `inputmode="${inputmode}" excluded` };

    // ── 7. autocomplete (sensitive fields) ──
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (EXCLUDED_AUTOCOMPLETE.has(autocomplete)) return { check: false, reason: `autocomplete="${autocomplete}" excluded` };

    // ── 8. ARIA role ──
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (EXCLUDED_ROLES.has(role)) return { check: false, reason: `role="${role}" excluded` };

    return { check: true, reason: 'eligible' };
  }

  /**
   * Walks up the DOM tree to find the nearest value of an attribute.
   * Checks the element itself, then its ancestors up to <body>.
   */
  function getInheritedAttr(el, attrName) {
    let node = el;
    while (node && node !== document.documentElement) {
      const val = node.getAttribute(attrName);
      if (val !== null) {
        if (node !== el) {
          log.debug(`Inherited ${attrName}="${val}" from ancestor ${describeElement(node)}`);
        }
        return val.toLowerCase();
      }
      node = node.parentElement;
    }
    return null;
  }

  /**
   * For contentEditable, event.target is often a child (<p>, <span>, etc).
   * This walks up to find the actual contentEditable host — the element
   * with the attribute set explicitly, not just inherited.
   */
  function resolveEditableHost(el) {
    if (!el) return null;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el;

    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      const ce = (node.getAttribute('contenteditable') || '').toLowerCase();
      if (ce === 'true' || ce === '' || ce === 'plaintext-only') {
        if (node !== el) {
          log.debug(`Resolved contentEditable host: ${describeElement(el)} → ${describeElement(node)}`);
        }
        return node;
      }
      node = node.parentElement;
    }
    return el;
  }

  function describeElement(el) {
    if (!el) return 'null';
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className ? `.${String(el.className).split(' ')[0]}` : '';
    const name = el.name ? `[name="${el.name}"]` : '';
    const ce = el.getAttribute('contenteditable') ? '[contenteditable]' : '';
    return `<${tag}${id}${cls}${name}${ce}>`;
  }

  function getTextFromElement(el) {
    let text = '';
    let source = '';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      text = el.value;
      source = 'value';
    } else if (el.isContentEditable) {
      text = el.innerText;
      source = 'innerText';
    }
    log.debug(`Read ${text.length} chars from ${describeElement(el)} via ${source}`);
    return text;
  }

  function setTextOnElement(el, text) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      log.debug(`Wrote ${text.length} chars to ${describeElement(el)} via value`);
    } else if (el.isContentEditable) {
      el.innerText = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      log.debug(`Wrote ${text.length} chars to ${describeElement(el)} via innerText`);
    } else {
      log.warn(`Cannot write to ${describeElement(el)} — not an editable element`);
    }
  }

  function createTooltip() {
    if (tooltipEl) return tooltipEl;

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'correctly-tooltip';
    tooltipEl.innerHTML = `
      <div class="correctly-tooltip-inner">
        <div class="correctly-tooltip-header">
          <span class="correctly-logo">Correctly</span>
          <button class="correctly-close" aria-label="Close">&times;</button>
        </div>
        <div class="correctly-body"></div>
        <div class="correctly-actions">
          <button class="correctly-accept">Accept All</button>
          <button class="correctly-dismiss">Dismiss</button>
        </div>
      </div>
    `;
    document.body.appendChild(tooltipEl);

    tooltipEl.querySelector('.correctly-close').addEventListener('click', hideTooltip);
    tooltipEl.querySelector('.correctly-dismiss').addEventListener('click', () => {
      log.info('User dismissed corrections — suppressing until next input');
      dismissedElement = activeElement;
      hideTooltip();
    });
    tooltipEl.querySelector('.correctly-accept').addEventListener('click', acceptCorrections);

    log.debug('Tooltip element created');
    return tooltipEl;
  }

  function showTooltip(element, correction) {
    currentCorrection = correction;
    const tooltip = createTooltip();
    const body = tooltip.querySelector('.correctly-body');

    if (correction.changes.length === 0) {
      body.innerHTML = '<p class="correctly-no-errors">No grammar issues found.</p>';
      tooltip.querySelector('.correctly-accept').style.display = 'none';
    } else {
      body.innerHTML = correction.changes.map((change, i) => `
        <div class="correctly-change" data-index="${i}">
          <div class="correctly-change-row">
            <div class="correctly-change-content">
              <div class="correctly-diff">
                <span class="correctly-original">${escapeHtml(change.original)}</span>
                <span class="correctly-arrow">&rarr;</span>
                <span class="correctly-replacement">${escapeHtml(change.replacement)}</span>
              </div>
              <p class="correctly-explanation">${escapeHtml(change.explanation)}</p>
            </div>
            <button class="correctly-accept-one" data-index="${i}" title="Accept this correction">&#10003;</button>
          </div>
        </div>
      `).join('');
      tooltip.querySelector('.correctly-accept').style.display = '';

      body.querySelectorAll('.correctly-accept-one').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          acceptSingleCorrection(parseInt(btn.dataset.index, 10));
        });
      });
    }

    positionTooltip(tooltip, element);
    tooltip.classList.add('correctly-visible');
    log.info(`Tooltip shown with ${correction.changes.length} correction(s)`);
  }

  const TOOLTIP_GAP = 8;
  const VIEWPORT_PADDING = 10;

  function positionTooltip(tooltip, element) {
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';
    tooltip.classList.add('correctly-visible');

    const elRect = element.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const tipW = tipRect.width;
    const tipH = tipRect.height;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const spaceBelow = vpH - elRect.bottom;
    const spaceAbove = elRect.top;

    let placement;
    let top, left;

    // Vertical: prefer below, fall back to above
    if (spaceBelow >= tipH + TOOLTIP_GAP + VIEWPORT_PADDING) {
      placement = 'below';
      top = elRect.bottom + scrollY + TOOLTIP_GAP;
    } else if (spaceAbove >= tipH + TOOLTIP_GAP + VIEWPORT_PADDING) {
      placement = 'above';
      top = elRect.top + scrollY - tipH - TOOLTIP_GAP;
    } else {
      // Neither fits fully — pick whichever side has more room
      if (spaceBelow >= spaceAbove) {
        placement = 'below-clamped';
        top = elRect.bottom + scrollY + TOOLTIP_GAP;
      } else {
        placement = 'above-clamped';
        top = elRect.top + scrollY - tipH - TOOLTIP_GAP;
      }
    }

    // Horizontal: try left-aligned with element, then clamp to viewport
    left = elRect.left + scrollX;

    if (left + tipW > scrollX + vpW - VIEWPORT_PADDING) {
      left = scrollX + vpW - tipW - VIEWPORT_PADDING;
    }
    if (left < scrollX + VIEWPORT_PADDING) {
      left = scrollX + VIEWPORT_PADDING;
    }

    // Vertical clamp to ensure tooltip stays in viewport
    const minTop = scrollY + VIEWPORT_PADDING;
    const maxTop = scrollY + vpH - tipH - VIEWPORT_PADDING;
    top = Math.max(minTop, Math.min(top, maxTop));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.style.visibility = '';
    tooltip.style.display = '';

    // Set placement attr for CSS arrow direction
    tooltip.dataset.placement = placement.startsWith('above') ? 'above' : 'below';

    // Compute arrow horizontal offset relative to tooltip left
    const elCenterX = elRect.left + scrollX + elRect.width / 2;
    const arrowOffset = Math.max(20, Math.min(elCenterX - left, tipW - 20));
    tooltip.style.setProperty('--arrow-offset', `${arrowOffset}px`);

    log.debug(`Tooltip placed: ${placement}`, {
      top, left, tipW, tipH,
      spaceAbove: Math.round(spaceAbove),
      spaceBelow: Math.round(spaceBelow),
      arrowOffset: Math.round(arrowOffset)
    });
  }

  function hideTooltip() {
    if (tooltipEl && tooltipEl.classList.contains('correctly-visible')) {
      tooltipEl.classList.remove('correctly-visible');
      log.debug('Tooltip hidden');
    }
    currentCorrection = null;
    removeIndicator();
  }

  function acceptSingleCorrection(index) {
    if (!activeElement || !currentCorrection) return;
    const change = currentCorrection.changes[index];
    if (!change) return;

    log.info(`Accepted correction: "${change.original}" → "${change.replacement}"`);

    const currentText = getTextFromElement(activeElement);
    const updatedText = currentText.replace(change.original, change.replacement);
    applyingCorrection = true;
    setTextOnElement(activeElement, updatedText);
    applyingCorrection = false;

    currentCorrection.changes.splice(index, 1);
    currentCorrection.corrected = updatedText;

    const changeEl = tooltipEl.querySelector(`.correctly-change[data-index="${index}"]`);
    if (changeEl) changeEl.remove();

    if (currentCorrection.changes.length === 0) {
      log.info('All corrections accepted individually');
      hideTooltip();
    } else {
      tooltipEl.querySelectorAll('.correctly-change').forEach((el, i) => {
        el.dataset.index = i;
        el.querySelector('.correctly-accept-one').dataset.index = i;
      });
    }
  }

  function acceptCorrections() {
    if (activeElement && currentCorrection && currentCorrection.changes.length > 0) {
      let text = getTextFromElement(activeElement);
      for (const change of currentCorrection.changes) {
        text = text.replace(change.original, change.replacement);
      }
      applyingCorrection = true;
      setTextOnElement(activeElement, text);
      applyingCorrection = false;
      log.info(`Applied remaining ${currentCorrection.changes.length} correction(s) on ${describeElement(activeElement)}`);
    }
    hideTooltip();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function showIndicator(element) {
    removeIndicator();
    const indicator = document.createElement('div');
    indicator.className = 'correctly-indicator';
    indicator.innerHTML = '<span class="correctly-indicator-dot"></span>';
    indicator.title = 'Correctly is checking...';

    const rect = element.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const vpW = window.innerWidth;
    const DOT_SIZE = 10;
    const INSET = 8;

    let top = rect.top + scrollY + INSET;
    let left = rect.right + scrollX - DOT_SIZE - INSET;

    // Right edge: move indicator to the left side of the element
    if (rect.right > vpW - VIEWPORT_PADDING) {
      left = rect.left + scrollX + INSET;
    }

    // Top edge: push indicator down inside the element
    if (rect.top < VIEWPORT_PADDING) {
      top = rect.bottom + scrollY - DOT_SIZE - INSET;
    }

    // Clamp inside viewport
    left = Math.max(scrollX + VIEWPORT_PADDING, Math.min(left, scrollX + vpW - DOT_SIZE - VIEWPORT_PADDING));
    top = Math.max(scrollY + VIEWPORT_PADDING, top);

    indicator.style.top = `${top}px`;
    indicator.style.left = `${left}px`;

    document.body.appendChild(indicator);
    log.debug(`Indicator shown for ${describeElement(element)} at (${Math.round(left)}, ${Math.round(top)})`);
  }

  function removeIndicator() {
    const indicators = document.querySelectorAll('.correctly-indicator');
    if (indicators.length > 0) {
      indicators.forEach(el => el.remove());
      log.debug(`Removed ${indicators.length} indicator(s)`);
    }
  }

  async function checkGrammar(element) {
    if (dismissedElement === element) {
      log.debug(`Check suppressed — user dismissed corrections on ${describeElement(element)}`);
      return;
    }

    const text = getTextFromElement(element);
    if (text.trim().length < MIN_TEXT_LENGTH) {
      log.info(`Text too short (${text.trim().length}/${MIN_TEXT_LENGTH} chars) — skipping check`);
      return;
    }

    log.info(`Checking grammar on ${describeElement(element)} — ${text.length} chars`);
    showIndicator(element);
    const endTimer = log.time('check-roundtrip');

    try {
      log.info('Sending CHECK_GRAMMAR to background…');
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_GRAMMAR',
        text: text
      });

      endTimer();
      removeIndicator();

      if (response.success) {
        const count = response.data.changes?.length || 0;
        log.info(`Response received — ${count} issue(s) found`);
        if (count > 0) {
          log.debug('Corrections:', response.data.changes.map(c => `"${c.original}" → "${c.replacement}"`));
          showTooltip(element, response.data);
        } else {
          log.debug('No issues — text is clean');
        }
      } else {
        log.error('Grammar check failed:', response.error);
      }
    } catch (err) {
      endTimer();
      removeIndicator();
      log.error('Message to background failed:', err.message);
    }
  }

  let lastLoggedElement = null;

  function handleInput(event) {
    if (applyingCorrection) {
      log.debug('Ignoring input event from our own correction');
      return;
    }

    const raw = event.target;
    const el = resolveEditableHost(raw);

    log.debug(`Input event → target: ${describeElement(raw)}, resolved: ${describeElement(el)}, isContentEditable: ${el?.isContentEditable}`);

    const decision = shouldCheckElement(el);

    if (!decision.check) {
      if (decision.reason !== 'not an editable prose element' && decision.reason !== 'null element') {
        log.info(`Input on ${describeElement(el)} — skipped: ${decision.reason}`);
      }
      return;
    }

    if (el !== lastLoggedElement) {
      log.info(`Typing detected on ${describeElement(el)} — ${decision.reason}`);
      lastLoggedElement = el;
    }

    if (dismissedElement === el) {
      log.debug('Dismissed element received new input — re-enabling checks');
      dismissedElement = null;
    }

    activeElement = el;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    log.debug(`Debounce started — will check in ${DEBOUNCE_MS}ms`);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      log.info(`Debounce complete — checking ${describeElement(el)}`);
      checkGrammar(el);
    }, DEBOUNCE_MS);
  }

  function handleFocusOut(event) {
    if (tooltipEl && tooltipEl.contains(event.relatedTarget)) {
      log.debug('Focus moved to tooltip — ignoring focusout');
      return;
    }

    const el = resolveEditableHost(event.target);
    const decision = shouldCheckElement(el);
    if (!decision.check) return;

    log.debug(`Focus out on ${describeElement(el)}`);

    if (debounceTimer) {
      log.debug('Clearing pending debounce timer (focus left element)');
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    const text = getTextFromElement(el);
    if (text.trim().length < MIN_TEXT_LENGTH) {
      log.debug(`Text too short on focus out (${text.trim().length} chars < ${MIN_TEXT_LENGTH}), skipping`);
      return;
    }

    log.info(`Focus out — triggering check on ${describeElement(el)}`);
    activeElement = el;
    checkGrammar(el);
  }

  async function init() {
    log.info(`Initializing on ${window.location.href}`);

    try {
      const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      log.info('Extension status:', status);

      if (!status.configured) {
        log.warn('No API key configured — Correctly is inactive. Click the extension icon to set up.');
        return;
      }
      if (!status.enabled) {
        log.warn('Extension is disabled by user');
        return;
      }
    } catch (err) {
      log.error('Failed to get extension status:', err.message);
      return;
    }

    document.addEventListener('input', handleInput, true);
    document.addEventListener('focusout', handleFocusOut, true);

    document.addEventListener('click', (e) => {
      if (tooltipEl && tooltipEl.classList.contains('correctly-visible') &&
          !tooltipEl.contains(e.target) && e.target !== activeElement) {
        log.debug('Click outside tooltip — dismissing');
        hideTooltip();
      }
    });

    let repositionRAF = null;
    function handleReposition() {
      if (repositionRAF) return;
      repositionRAF = requestAnimationFrame(() => {
        repositionRAF = null;
        if (tooltipEl && tooltipEl.classList.contains('correctly-visible') && activeElement) {
          log.debug('Repositioning tooltip after scroll/resize');
          positionTooltip(tooltipEl, activeElement);
        }
      });
    }
    window.addEventListener('scroll', handleReposition, { passive: true, capture: true });
    window.addEventListener('resize', handleReposition, { passive: true });

    log.info('Event listeners attached — Correctly is active');
  }

  init();
})();
