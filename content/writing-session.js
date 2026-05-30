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
      });
      this.debounceTimer = null;
      this.dismissedElement = null;
      this.lastCheckedText = new WeakMap();
      this.checkGeneration = 0;
      this.applyingCorrection = false;
    }

    handleInput(event) {
      if (this.applyingCorrection) return;
      const raw = event.target;
      const el = this.resolveEditableHost(raw);
      const decision = this.shouldCheckElement(el);
      if (!decision.check) return;
      if (this.dismissedElement === el) this.dismissedElement = null;
      this.setActiveElement(el);
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.checkGrammar(el);
      }, this.debounceMs);
    }

    handleFocusOut(event) {
      if (this.isTooltipFocus(event.relatedTarget)) return;
      const el = this.resolveEditableHost(event.target);
      const decision = this.shouldCheckElement(el);
      if (!decision.check) return;
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      const text = this.getTextFromElement(el);
      if (text.trim().length < this.minTextLength) return;
      this.setActiveElement(el);
      this.checkGrammar(el);
    }

    async checkGrammar(element) {
      if (this.dismissedElement === element) return;
      const text = this.getTextFromElement(element);
      if (text.trim().length < this.minTextLength) return;
      if (this.lastCheckedText.get(element) === text) return;
      const gen = ++this.checkGeneration;
      this.showIndicator(element);
      try {
        const response = await this.sendCheck(text);
        if (gen !== this.checkGeneration) return;
        this.removeIndicator();
        if (response.success) {
          this.lastCheckedText.set(element, text);
          const count = this.getCorrectionCount(response.data, text);
          if (count === 0) return;
          this.showTooltip(element, response.data);
        } else {
          this.showCheckErrorNudge(response.error, element);
        }
      } catch {
        if (gen !== this.checkGeneration) return;
        this.removeIndicator();
        this.showCheckErrorNudge(null, element);
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
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      this.lastCheckedText = new WeakMap();
      this.dismissedElement = null;
    }
  }

  globalThis.CorrectlyWritingSession = WritingSession;
})();
