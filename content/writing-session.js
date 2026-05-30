(() => {
  class WritingSession {
    constructor({
      debounceMs,
      minTextLength,
      resolveEditableHost,
      shouldCheckElement,
      getTextFromElement,
      sendCheck,
      showIndicator,
      removeIndicator,
      showTooltip,
      showCheckErrorNudge,
      isTooltipFocus,
      setActiveElement,
      getCorrectionCount,
      log,
    }) {
      Object.assign(this, {
        debounceMs,
        minTextLength,
        resolveEditableHost,
        shouldCheckElement,
        getTextFromElement,
        sendCheck,
        showIndicator,
        removeIndicator,
        showTooltip,
        showCheckErrorNudge,
        isTooltipFocus,
        setActiveElement,
        getCorrectionCount,
        log,
      });
      this.debounceTimer = null;
      this.dismissedElement = null;
      this.lastCheckedText = new WeakMap();
      this.checkGeneration = 0;
      this.applyingCorrection = false;
    }

    handleInput(event) {
      if (this.applyingCorrection) {
        this.log?.debug("Skipping input while applying correction");
        return;
      }
      const raw = event.target;
      const el = this.resolveEditableHost(raw);
      const decision = this.shouldCheckElement(el);
      if (!decision.check) {
        this.log?.debug(`Skipping check: ${decision.reason}`);
        return;
      }
      if (this.dismissedElement === el) {
        this.log?.debug("New input on dismissed element — resuming checks");
        this.dismissedElement = null;
      }
      this.setActiveElement(el);
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.log?.debug("Debounce reset");
      }
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.log?.debug("Debounce timer fired — checking grammar");
        this.checkGrammar(el);
      }, this.debounceMs);
    }

    handleFocusOut(event) {
      if (this.isTooltipFocus(event.relatedTarget)) return;
      const el = this.resolveEditableHost(event.target);
      const decision = this.shouldCheckElement(el);
      if (!decision.check) {
        this.log?.debug(`FocusOut skip: ${decision.reason}`);
        return;
      }
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
        this.log?.debug("Debounce cancelled on focusout");
      }
      const text = this.getTextFromElement(el);
      if (text.trim().length < this.minTextLength) return;
      this.setActiveElement(el);
      this.checkGrammar(el);
    }

    async checkGrammar(element) {
      if (this.dismissedElement === element) {
        this.log?.debug("Skipping dismissed element");
        return;
      }
      const text = this.getTextFromElement(element);
      if (text.trim().length < this.minTextLength) {
        this.log?.debug(`Text too short (${text.trim().length} < ${this.minTextLength})`);
        return;
      }
      if (this.lastCheckedText.get(element) === text) {
        this.log?.debug("Text unchanged since last check");
        return;
      }
      const gen = ++this.checkGeneration;
      this.log?.debug(`Check generation ${gen} started`);
      this.showIndicator(element);
      const startTime = performance.now();
      try {
        const response = await this.sendCheck(text);
        if (gen !== this.checkGeneration) {
          this.log?.debug(`Check generation ${gen} stale — response dropped`);
          return;
        }
        this.removeIndicator();
        if (response.success) {
          this.lastCheckedText.set(element, text);
          const count = this.getCorrectionCount(response.data, text);
          if (count === 0) return;
          this.showTooltip(element, response.data);
        } else {
          this.showCheckErrorNudge(response.error, element);
        }
        this.log?.debug(`Check generation ${gen} completed in ${Math.round(performance.now() - startTime)}ms`);
      } catch {
        if (gen !== this.checkGeneration) {
          this.log?.debug(`Check generation ${gen} stale — error dropped`);
          return;
        }
        this.removeIndicator();
        this.showCheckErrorNudge(null, element);
        this.log?.debug(`Check generation ${gen} errored after ${Math.round(performance.now() - startTime)}ms`);
      }
    }

    recordAppliedText(element, text) {
      this.lastCheckedText.set(element, text);
    }
    recordIgnore(element) {
      this.dismissedElement = element;
    }
    beginApply() {
      this.applyingCorrection = true;
    }
    endApply() {
      this.applyingCorrection = false;
    }
    deactivate() {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.log?.debug("Debounce timer cleared on deactivate");
      }
      this.debounceTimer = null;
      this.lastCheckedText = new WeakMap();
      this.dismissedElement = null;
      this.applyingCorrection = false;
      this.log?.debug("Session deactivated");
    }
  }

  globalThis.CorrectlyWritingSession = WritingSession;
})();
