(async () => {
  const LOG_PREFIX = "[Correctly][content]";
  const LOG_STYLES = {
    debug: "color: #888",
    info: "color: #2d7d46; font-weight: bold",
    warn: "color: #e65100; font-weight: bold",
    error: "color: #c62828; font-weight: bold",
  };
  const LOG_RANKS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
  let logRank = LOG_RANKS.info;

  chrome.storage.local
    .get("logLevel")
    .then(({ logLevel }) => {
      if (logLevel && LOG_RANKS[logLevel] !== undefined) logRank = LOG_RANKS[logLevel];
    })
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.logLevel) {
      const level = changes.logLevel.newValue || "info";
      if (LOG_RANKS[level] !== undefined) logRank = LOG_RANKS[level];
    }
  });

  const log = {
    debug: (...args) => {
      if (LOG_RANKS.debug >= logRank) console.debug(`%c${LOG_PREFIX}`, LOG_STYLES.debug, ...args);
    },
    info: (...args) => {
      if (LOG_RANKS.info >= logRank) console.info(`%c${LOG_PREFIX}`, LOG_STYLES.info, ...args);
    },
    warn: (...args) => {
      if (LOG_RANKS.warn >= logRank) console.warn(`%c${LOG_PREFIX}`, LOG_STYLES.warn, ...args);
    },
    error: (...args) => {
      if (LOG_RANKS.error >= logRank) console.error(`%c${LOG_PREFIX}`, LOG_STYLES.error, ...args);
    },
    time: (label) => {
      if (LOG_RANKS.debug < logRank) return () => {};
      const k = `${LOG_PREFIX} ${label}#${Date.now()}`;
      console.time(k);
      return () => console.timeEnd(k);
    },
  };

  const DEBOUNCE_MS = 1500;
  const MIN_TEXT_LENGTH = 10;
  const IGNORE_NUDGE_THRESHOLD = 3;
  const ERROR_NUDGE_COOLDOWN_MS = 30000;

  let debounceTimer = null;
  let activeElement = null;
  let tooltipEl = null;
  let currentCorrection = null;
  let applyingCorrection = false;
  let dismissedElement = null;
  let indicatorEl = null;
  let tooltipOwnerElement = null;
  let ignoreState = new WeakMap();
  let lastCheckedText = new WeakMap();
  let checkGeneration = 0;
  let lastErrorNudge = { message: "", timestamp: 0 };

  // Input types that contain prose and should be grammar-checked
  const PROSE_INPUT_TYPES = new Set(["text", "search", "email"]);

  // Input types that should never be grammar-checked
  const EXCLUDED_INPUT_TYPES = new Set([
    "password",
    "number",
    "tel",
    "url",
    "date",
    "datetime-local",
    "time",
    "month",
    "week",
    "color",
    "range",
    "file",
    "hidden",
  ]);

  // inputmode values that signal non-prose input
  const EXCLUDED_INPUTMODES = new Set(["numeric", "decimal", "tel", "none"]);

  // autocomplete values that indicate sensitive or non-prose fields
  const EXCLUDED_AUTOCOMPLETE = new Set([
    "cc-number",
    "cc-exp",
    "cc-csc",
    "cc-type",
    "tel",
    "tel-national",
    "tel-country-code",
    "one-time-code",
    "postal-code",
    "bday",
    "new-password",
    "current-password",
  ]);

  // ARIA roles where grammar checking would be inappropriate
  const EXCLUDED_ROLES = new Set(["spinbutton", "slider", "switch", "combobox", "listbox", "menu"]);

  /**
   * Determines if an element should be grammar-checked.
   * Respects HTML standards, ARIA attributes,
   * and our own data-correctly attribute.
   *
   * Returns { check: boolean, reason: string } so decisions can be logged.
   */
  function shouldCheckElement(el) {
    if (!el) return { check: false, reason: "null element" };

    // ── 1. Our own override (highest priority) ──
    const correctly = getInheritedAttr(el, "data-correctly");
    if (correctly === "false") return { check: false, reason: 'data-correctly="false"' };
    if (correctly === "true") return { check: true, reason: 'data-correctly="true" (forced)' };

    // ── 2. Basic element eligibility ──
    const tag = el.tagName;
    let eligible = false;

    if (tag === "TEXTAREA") {
      eligible = true;
    } else if (tag === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      if (PROSE_INPUT_TYPES.has(type)) {
        eligible = true;
      } else if (EXCLUDED_INPUT_TYPES.has(type)) {
        return { check: false, reason: `input type="${type}" excluded` };
      }
    } else if (el.isContentEditable) {
      eligible = true;
    }

    if (!eligible) return { check: false, reason: "not an editable prose element" };

    // ── 3. Disabled / readonly state ──
    if (el.disabled) return { check: false, reason: "element is disabled" };
    if (el.readOnly) return { check: false, reason: "element is readonly" };
    if (el.getAttribute("aria-disabled") === "true") return { check: false, reason: 'aria-disabled="true"' };
    if (el.getAttribute("aria-readonly") === "true") return { check: false, reason: 'aria-readonly="true"' };

    // ── 4. HTML spellcheck attribute (standard) ──
    const spellcheck = getInheritedAttr(el, "spellcheck");
    if (spellcheck === "false") return { check: false, reason: 'spellcheck="false"' };

    // ── 5. inputmode (non-prose keyboards) ──
    const inputmode = (el.getAttribute("inputmode") || "").toLowerCase();
    if (EXCLUDED_INPUTMODES.has(inputmode)) return { check: false, reason: `inputmode="${inputmode}" excluded` };

    // ── 6. autocomplete (sensitive fields) ──
    const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (EXCLUDED_AUTOCOMPLETE.has(autocomplete))
      return {
        check: false,
        reason: `autocomplete="${autocomplete}" excluded`,
      };

    // ── 7. ARIA role ──
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (EXCLUDED_ROLES.has(role)) return { check: false, reason: `role="${role}" excluded` };

    return { check: true, reason: "eligible" };
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
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return el;

    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      const ce = (node.getAttribute("contenteditable") || "").toLowerCase();
      if (ce === "true" || ce === "" || ce === "plaintext-only") {
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
    if (!el) return "null";
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls = el.className ? `.${String(el.className).split(" ")[0]}` : "";
    const name = el.name ? `[name="${el.name}"]` : "";
    const ce = el.getAttribute("contenteditable") ? "[contenteditable]" : "";
    return `<${tag}${id}${cls}${name}${ce}>`;
  }

  function getTextFromElement(el) {
    let text = "";
    let source = "";
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      text = el.value;
      source = "value";
    } else if (el.isContentEditable) {
      text = el.innerText;
      source = "innerText";
    }
    log.debug(`Read ${text.length} chars from ${describeElement(el)} via ${source}`);
    return text;
  }

  function setTextOnElement(el, text) {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      log.debug(`Wrote ${text.length} chars to ${describeElement(el)} via value`);
    } else if (el.isContentEditable) {
      el.innerText = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      log.debug(`Wrote ${text.length} chars to ${describeElement(el)} via innerText`);
    } else {
      log.warn(`Cannot write to ${describeElement(el)} — not an editable element`);
    }
  }

  function createTooltip() {
    if (tooltipEl) return tooltipEl;

    tooltipEl = document.createElement("div");
    tooltipEl.className = "correctly-tooltip";
    tooltipEl.id = "correctly-suggestions";
    tooltipEl.setAttribute("role", "dialog");
    tooltipEl.setAttribute("aria-labelledby", "correctly-suggestions-title");
    tooltipEl.setAttribute("aria-live", "polite");
    tooltipEl.setAttribute("tabindex", "-1");

    const inner = document.createElement("div");
    inner.className = "correctly-tooltip-inner";

    const header = document.createElement("div");
    header.className = "correctly-tooltip-header";

    const title = document.createElement("span");
    title.className = "correctly-logo";
    title.id = "correctly-suggestions-title";
    title.textContent = "Correctly";

    const count = document.createElement("span");
    count.className = "correctly-suggestion-count";
    count.id = "correctly-suggestion-count";

    const close = document.createElement("button");
    close.className = "correctly-close";
    close.type = "button";
    close.setAttribute("aria-label", "Close suggestions");
    close.textContent = "\u00d7";

    const body = document.createElement("div");
    body.className = "correctly-body";
    body.id = "correctly-suggestions-body";

    const actions = document.createElement("div");
    actions.className = "correctly-actions";

    const accept = document.createElement("button");
    accept.className = "correctly-accept";
    accept.type = "button";
    accept.textContent = "Apply all";

    const dismiss = document.createElement("button");
    dismiss.className = "correctly-dismiss";
    dismiss.type = "button";
    dismiss.textContent = "Ignore";

    header.append(title, count, close);
    actions.append(accept, dismiss);
    inner.append(header, body, actions);
    tooltipEl.appendChild(inner);
    document.body.appendChild(tooltipEl);

    close.addEventListener("click", hideTooltip);
    dismiss.addEventListener("click", () => {
      log.info("User ignored corrections");
      recordIgnore(activeElement);
      hideTooltip();
    });
    accept.addEventListener("click", acceptCorrections);
    tooltipEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        hideTooltip();
        activeElement?.focus?.();
      }
    });
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && tooltipEl?.classList.contains("correctly-visible")) {
          hideTooltip();
        }
      },
      true,
    );

    body.addEventListener("click", (e) => {
      const btn = e.target.closest(".correctly-accept-one");
      if (!btn) return;
      e.stopPropagation();
      acceptSingleCorrection(parseInt(btn.dataset.index, 10));
    });

    log.debug("Tooltip element created");
    return tooltipEl;
  }

  function showTooltip(element, correction) {
    currentCorrection = correction;

    const tooltip = createTooltip();
    const body = tooltip.querySelector(".correctly-body");
    const acceptButton = tooltip.querySelector(".correctly-accept");
    const countLabel = tooltip.querySelector(".correctly-suggestion-count");

    const { changes, corrected, confidence, cascadeLevel } = correction;
    const currentText = getTextFromElement(element);
    const issueCount = getCorrectionCount(correction, currentText);

    countLabel.textContent = formatSuggestionCount(issueCount);
    body.replaceChildren();
    if (changes.length === 0) {
      const hasFullTextCorrection = corrected && corrected !== currentText;

      if (hasFullTextCorrection) {
        const change = document.createElement("div");
        change.className = "correctly-change";
        change.appendChild(createSuggestionText(currentText, corrected));
        appendConfidence(change, confidence, cascadeLevel);
        body.appendChild(change);
      } else {
        const noErrors = document.createElement("p");
        noErrors.className = "correctly-no-errors";
        noErrors.textContent = "No grammar issues found.";
        body.appendChild(noErrors);
      }

      acceptButton.hidden = !hasFullTextCorrection;
    } else {
      body.append(...changes.map((change, index) => createChangeItem(change, index)));
      acceptButton.hidden = false;
    }

    tooltipOwnerElement?.removeAttribute("aria-describedby");
    tooltipOwnerElement = element;
    element.setAttribute("aria-describedby", "correctly-suggestions-body");
    positionTooltip(tooltip, element);
    tooltip.classList.add("correctly-visible");

    log.info(`Tooltip shown with ${changes.length} correction(s)`);
  }

  function getCorrectionCount(correction, currentText = "") {
    const changeCount = correction.changes?.length || 0;
    if (changeCount > 0) return changeCount;
    return correction.corrected && correction.corrected !== currentText ? 1 : 0;
  }

  function formatSuggestionCount(count) {
    if (count === 0) return "No issues";
    if (count === 1) return "1 suggestion";
    return `${count} suggestions`;
  }

  function createChangeItem(change, index) {
    const item = document.createElement("div");
    item.className = "correctly-change";
    item.dataset.index = String(index);

    const row = document.createElement("div");
    row.className = "correctly-change-row";

    const content = document.createElement("div");
    content.className = "correctly-change-content";
    content.appendChild(createSuggestionText(change.original, change.replacement));

    const explanation = document.createElement("p");
    explanation.className = "correctly-explanation";
    explanation.textContent = change.explanation;
    content.appendChild(explanation);

    const acceptOne = document.createElement("button");
    acceptOne.className = "correctly-accept-one";
    acceptOne.type = "button";
    acceptOne.dataset.index = String(index);
    acceptOne.setAttribute("aria-label", `Accept correction: replace ${change.original} with ${change.replacement}`);
    acceptOne.textContent = "\u2713";

    row.append(content, acceptOne);
    item.appendChild(row);
    return item;
  }

  function createSuggestionText(original, replacement) {
    const suggestion = document.createElement("div");
    suggestion.className = "correctly-suggestion-text";

    const replacementEl = document.createElement("span");
    replacementEl.className = "correctly-replacement";
    replacementEl.textContent = replacement;

    const originalLine = document.createElement("div");
    originalLine.className = "correctly-original-line";
    originalLine.append("Replace ");

    const originalEl = document.createElement("span");
    originalEl.className = "correctly-original";
    originalEl.textContent = original;
    originalLine.appendChild(originalEl);

    suggestion.append(replacementEl, originalLine);
    return suggestion;
  }

  function appendConfidence(parent, confidence, cascadeLevel = null) {
    if (!confidence) return;
    const confidenceEl = document.createElement("p");
    confidenceEl.className = "correctly-confidence";
    if (cascadeLevel >= 3) {
      confidenceEl.textContent = "Corrected whole text";
      parent.appendChild(confidenceEl);
      return;
    }
    const score = confidence > 0 && confidence <= 10 ? confidence * 10 : confidence;
    confidenceEl.textContent = `Confidence: ${Math.round(Math.min(100, Math.max(0, score)))}%`;
    parent.appendChild(confidenceEl);
  }
  const TOOLTIP_GAP = 8;
  const VIEWPORT_PADDING = 10;

  function positionTooltip(tooltip, element) {
    tooltip.style.visibility = "hidden";
    tooltip.style.display = "block";
    tooltip.classList.add("correctly-visible");

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
      placement = "below";
      top = elRect.bottom + scrollY + TOOLTIP_GAP;
    } else if (spaceAbove >= tipH + TOOLTIP_GAP + VIEWPORT_PADDING) {
      placement = "above";
      top = elRect.top + scrollY - tipH - TOOLTIP_GAP;
    } else {
      // Neither fits fully — pick whichever side has more room
      if (spaceBelow >= spaceAbove) {
        placement = "below-clamped";
        top = elRect.bottom + scrollY + TOOLTIP_GAP;
      } else {
        placement = "above-clamped";
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
    tooltip.style.visibility = "";
    tooltip.style.display = "";

    // Set placement attr for CSS arrow direction
    tooltip.dataset.placement = placement.startsWith("above") ? "above" : "below";

    // Compute arrow horizontal offset relative to tooltip left
    const elCenterX = elRect.left + scrollX + elRect.width / 2;
    const arrowOffset = Math.max(20, Math.min(elCenterX - left, tipW - 20));
    tooltip.style.setProperty("--arrow-offset", `${arrowOffset}px`);

    log.debug(`Tooltip placed: ${placement}`, {
      top,
      left,
      tipW,
      tipH,
      spaceAbove: Math.round(spaceAbove),
      spaceBelow: Math.round(spaceBelow),
      arrowOffset: Math.round(arrowOffset),
    });
  }

  function hideTooltip() {
    if (tooltipEl?.classList.contains("correctly-visible")) {
      tooltipEl.classList.remove("correctly-visible");
      log.debug("Tooltip hidden");
    }
    tooltipOwnerElement?.removeAttribute("aria-describedby");
    tooltipOwnerElement = null;
    currentCorrection = null;
    removeIndicator();
  }

  function getElementIgnoreState(element) {
    if (!element) return { streak: 0, nudgeShown: false };
    let state = ignoreState.get(element);
    if (!state) {
      state = { streak: 0, nudgeShown: false };
      ignoreState.set(element, state);
    }
    return state;
  }

  function recordIgnore(element) {
    if (!element) return;
    const state = getElementIgnoreState(element);
    state.streak += 1;
    dismissedElement = element;
    removeIndicator();
    if (state.streak >= IGNORE_NUDGE_THRESHOLD) {
      if (!state.nudgeShown) {
        showIgnoreNudge(element);
        state.nudgeShown = true;
      }
      log.info(`Repeated ignores detected on ${describeElement(element)}`);
    }
  }

  function resetIgnoreState(element) {
    if (!element) return;
    const state = getElementIgnoreState(element);
    state.streak = 0;
    state.nudgeShown = false;
  }

  function acceptSingleCorrection(index) {
    if (!activeElement || !currentCorrection) return;
    const change = currentCorrection.changes[index];
    if (!change) return;

    log.info(`Accepted correction: "${change.original}" → "${change.replacement}"`);

    const currentText = getTextFromElement(activeElement);
    const updatedText = currentText.replace(change.original, change.replacement);
    applyingCorrection = true;
    try {
      setTextOnElement(activeElement, updatedText);
    } finally {
      applyingCorrection = false;
    }
    lastCheckedText.set(activeElement, updatedText);
    resetIgnoreState(activeElement);

    currentCorrection.changes.splice(index, 1);

    const changeEl = tooltipEl.querySelector(`.correctly-change[data-index="${index}"]`);
    if (changeEl) changeEl.remove();

    if (currentCorrection.changes.length === 0) {
      log.info("All corrections accepted individually");
      hideTooltip();
    } else {
      showTooltip(activeElement, currentCorrection);
    }
  }

  function acceptCorrections() {
    if (!activeElement || !currentCorrection) {
      hideTooltip();
      return;
    }

    if (currentCorrection.changes.length > 0) {
      let text = getTextFromElement(activeElement);
      for (const change of currentCorrection.changes) {
        text = text.replace(change.original, change.replacement);
      }
      applyingCorrection = true;
      try {
        setTextOnElement(activeElement, text);
      } finally {
        applyingCorrection = false;
      }
      lastCheckedText.set(activeElement, text);
      resetIgnoreState(activeElement);
      log.info(`Applied ${currentCorrection.changes.length} correction(s) on ${describeElement(activeElement)}`);
    } else if (currentCorrection.corrected) {
      applyingCorrection = true;
      try {
        setTextOnElement(activeElement, currentCorrection.corrected);
      } finally {
        applyingCorrection = false;
      }
      lastCheckedText.set(activeElement, currentCorrection.corrected);
      resetIgnoreState(activeElement);
      log.info(`Applied full text correction on ${describeElement(activeElement)}`);
    }

    hideTooltip();
  }

  // ── Cascade progress listener ──

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CHECK_PROGRESS") {
      if (!indicatorEl) return;
      const dot = indicatorEl.querySelector(".correctly-indicator-dot");
      if (!dot) return;
      dot.className = `correctly-indicator-dot correctly-indicator-dot--${msg.status}`;
    }
  });

  function showIndicator(element, status = "checking") {
    removeIndicator();
    const indicator = document.createElement("div");
    indicator.className = "correctly-indicator";
    indicator.setAttribute("aria-hidden", "true");
    const dot = document.createElement("span");
    dot.className = `correctly-indicator-dot correctly-indicator-dot--${status}`;
    indicator.appendChild(dot);

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
    indicatorEl = indicator;
    log.debug(`Indicator shown for ${describeElement(element)} at (${Math.round(left)}, ${Math.round(top)})`);
  }

  function showIgnoreNudge(element) {
    showNudge({
      anchor: element,
      message:
        "We noticed you keep ignoring suggestions here. If they are getting in the way, you can disable Correctly on this site.",
      actions: [
        {
          label: "Disable on this site",
          kind: "primary",
          onClick: disableOnCurrentSite,
        },
        {
          label: "Dismiss",
          kind: "secondary",
          onClick: () => {
            resetIgnoreState(element);
            removeNudges();
          },
        },
      ],
    });
  }

  async function disableOnCurrentSite() {
    const hostname = window.location.hostname;
    if (!hostname) return;
    const { disabledSites = [] } = await chrome.storage.local.get("disabledSites");
    const sites = new Set(disabledSites);
    sites.add(hostname);
    await chrome.storage.local.set({ disabledSites: [...sites] });
    removeNudges();
    deactivate();
    showDisabledNudge();
    log.info(`Disabled on ${hostname} from content nudge`);
  }

  function showDisabledNudge() {
    showNudge({
      message: "Correctly is disabled on this site. You can enable it again from the extension settings.",
      compact: true,
      durationMs: 4200,
    });
  }

  function showCheckErrorNudge(error, element) {
    const message = error
      ? `Correctly could not check this text. ${error}`
      : "Correctly could not check this text. Try again in a moment.";
    const now = Date.now();

    if (lastErrorNudge.message === message && now - lastErrorNudge.timestamp < ERROR_NUDGE_COOLDOWN_MS) {
      return;
    }

    lastErrorNudge = { message, timestamp: now };
    showNudge({
      anchor: element,
      message,
      compact: true,
      durationMs: 6000,
    });
  }

  function showNudge({ message, actions = [], anchor = null, compact = false, durationMs = null }) {
    removeNudges();
    const nudge = document.createElement("div");
    nudge.className = compact ? "correctly-nudge correctly-nudge--compact" : "correctly-nudge";
    nudge.setAttribute("role", "status");
    nudge.setAttribute("aria-live", "polite");

    if (actions.length > 0) {
      const messageEl = document.createElement("div");
      messageEl.className = "correctly-nudge__message";
      messageEl.textContent = message;

      const actionsEl = document.createElement("div");
      actionsEl.className = "correctly-nudge__actions";

      actionsEl.append(
        ...actions.map((action) => {
          const button = document.createElement("button");
          button.className =
            action.kind === "primary"
              ? "correctly-nudge__action correctly-nudge__action--primary"
              : "correctly-nudge__action";
          button.type = "button";
          button.textContent = action.label;
          button.addEventListener("click", action.onClick);
          return button;
        }),
      );

      nudge.append(messageEl, actionsEl);
    } else {
      nudge.textContent = message;
    }

    document.body.appendChild(nudge);

    const { top, left } = getNudgePosition(anchor);
    nudge.style.top = `${top}px`;
    nudge.style.left = `${left}px`;

    if (durationMs !== null) {
      setTimeout(() => {
        nudge.classList.add("correctly-nudge--leaving");
        setTimeout(() => nudge.remove(), 180);
      }, durationMs);
    }
  }

  function getNudgePosition(anchor) {
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      return {
        top: Math.min(window.scrollY + window.innerHeight - 56, rect.bottom + window.scrollY + 12),
        left: Math.max(
          window.scrollX + VIEWPORT_PADDING,
          Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - 330),
        ),
      };
    }

    return {
      top: window.scrollY + VIEWPORT_PADDING,
      left: Math.max(
        window.scrollX + VIEWPORT_PADDING,
        Math.min(window.scrollX + window.innerWidth - 330, window.scrollX + window.innerWidth / 2 - 160),
      ),
    };
  }

  function removeNudges() {
    document.querySelectorAll(".correctly-nudge").forEach((el) => {
      el.remove();
    });
  }

  function removeIndicator() {
    if (indicatorEl) {
      indicatorEl.remove();
      indicatorEl = null;
      log.debug("Indicator removed");
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

    if (lastCheckedText.get(element) === text) {
      log.debug(`Text unchanged since last check on ${describeElement(element)} — skipping`);
      return;
    }

    const gen = ++checkGeneration;
    log.info(`Checking grammar on ${describeElement(element)} — ${text.length} chars (gen ${gen})`);
    showIndicator(element);
    const endTimer = log.time("check-roundtrip");

    try {
      log.info("Sending CHECK_GRAMMAR to background…");
      const response = await chrome.runtime.sendMessage({
        type: "CHECK_GRAMMAR",
        text: text,
      });

      endTimer();

      if (gen !== checkGeneration) {
        log.debug(`Check gen ${gen} superseded by gen ${checkGeneration} — discarding stale response`);
        return;
      }

      removeIndicator();

      if (response.success) {
        lastCheckedText.set(element, text);
        const count = getCorrectionCount(response.data, text);
        log.info(`Response received — ${count} issue(s) found`);
        if (count > 0) {
          log.debug(
            "Corrections:",
            (response.data.changes || []).map((c) => `"${c.original}" → "${c.replacement}"`),
          );
        }
        if (count === 0) return;
        showTooltip(element, response.data);
      } else {
        log.error("Grammar check failed:", response.error);
        showCheckErrorNudge(response.error, element);
      }
    } catch (err) {
      endTimer();

      if (gen !== checkGeneration) {
        log.debug(`Check gen ${gen} error discarded (superseded by gen ${checkGeneration})`);
        return;
      }

      removeIndicator();
      log.error("Message to background failed:", err.message);
      showCheckErrorNudge(null, element);
    }
  }

  let lastLoggedElement = null;

  function handleInput(event) {
    if (applyingCorrection) {
      log.debug("Ignoring input event from our own correction");
      return;
    }

    const raw = event.target;
    const el = resolveEditableHost(raw);

    log.debug(
      `Input event → target: ${describeElement(raw)}, resolved: ${describeElement(el)}, isContentEditable: ${el?.isContentEditable}`,
    );

    const decision = shouldCheckElement(el);

    if (!decision.check) {
      if (decision.reason !== "not an editable prose element" && decision.reason !== "null element") {
        log.info(`Input on ${describeElement(el)} — skipped: ${decision.reason}`);
      }
      return;
    }

    if (el !== lastLoggedElement) {
      log.info(`Typing detected on ${describeElement(el)} — ${decision.reason}`);
      lastLoggedElement = el;
    }

    if (dismissedElement === el) {
      log.debug("Dismissed element received new input — re-enabling checks");
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
    if (tooltipEl?.contains(event.relatedTarget)) {
      log.debug("Focus moved to tooltip — ignoring focusout");
      return;
    }

    const el = resolveEditableHost(event.target);
    const decision = shouldCheckElement(el);
    if (!decision.check) return;

    log.debug(`Focus out on ${describeElement(el)}`);

    if (debounceTimer) {
      log.debug("Clearing pending debounce timer (focus left element)");
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

  let siteActive = false;

  function activate() {
    if (siteActive) return;
    siteActive = true;
    document.addEventListener("input", handleInput, true);
    document.addEventListener("focusout", handleFocusOut, true);
    log.info("Event listeners attached — Correctly is active");
  }

  function deactivate() {
    if (!siteActive) return;
    siteActive = false;
    document.removeEventListener("input", handleInput, true);
    document.removeEventListener("focusout", handleFocusOut, true);
    hideTooltip();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    lastCheckedText = new WeakMap();
    dismissedElement = null;
    ignoreState = new WeakMap();
    activeElement = null;
    log.info("Event listeners removed — Correctly is paused on this site");
  }

  async function init() {
    log.info(`Initializing on ${window.location.href}`);

    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName !== "local") return;
      if (changes.enabled || changes.disabledSites || changes.apiKey || changes.providerId || changes.baseUrl) {
        try {
          const status = await chrome.runtime.sendMessage({
            type: "GET_STATUS",
          });
          if (!status.configured || !status.enabled) {
            deactivate();
            return;
          }
          const { disabledSites = [] } = await chrome.storage.local.get("disabledSites");
          if (disabledSites.includes(window.location.hostname)) {
            deactivate();
          } else {
            activate();
          }
        } catch {
          deactivate();
        }
      }
    });

    try {
      const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
      log.info("Extension status:", status);

      if (!status.configured) {
        log.warn("No API key configured — Correctly is inactive. Click the extension icon to set up.");
        return;
      }
      if (!status.enabled) {
        log.warn("Extension is disabled by user");
        return;
      }
    } catch (err) {
      log.error("Failed to get extension status:", err.message);
      return;
    }

    try {
      const { disabledSites = [] } = await chrome.storage.local.get("disabledSites");
      if (disabledSites.includes(window.location.hostname)) {
        log.info(`Disabled on ${window.location.hostname} — skipping`);
      } else {
        activate();
      }
    } catch (err) {
      log.error("Failed to check site list:", err.message);
      activate();
    }

    document.addEventListener("click", (e) => {
      if (
        tooltipEl?.classList.contains("correctly-visible") &&
        !tooltipEl.contains(e.target) &&
        e.target !== activeElement
      ) {
        log.debug("Click outside tooltip — dismissing");
        hideTooltip();
      }
    });

    let repositionRAF = null;
    function handleReposition() {
      if (repositionRAF) return;
      repositionRAF = requestAnimationFrame(() => {
        repositionRAF = null;
        if (tooltipEl?.classList.contains("correctly-visible") && activeElement) {
          log.debug("Repositioning tooltip after scroll/resize");
          positionTooltip(tooltipEl, activeElement);
        }
      });
    }
    window.addEventListener("scroll", handleReposition, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", handleReposition, { passive: true });
  }

  init();
})();
