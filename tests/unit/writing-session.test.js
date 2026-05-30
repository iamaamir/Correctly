import { describe, expect, it, vi } from "vitest";
import "../../content/writing-session.js";

const WritingSession = globalThis.CorrectlyWritingSession;

function makeElement() {
  return {};
}

function makeSession(overrides = {}) {
  return new WritingSession({
    debounceMs: 0,
    minTextLength: 3,
    resolveEditableHost: (el) => el,
    shouldCheckElement: () => ({ check: true, reason: "eligible" }),
    getTextFromElement: () => "hello world",
    sendCheck: vi.fn().mockResolvedValue({ success: true, data: {} }),
    showIndicator: vi.fn(),
    removeIndicator: vi.fn(),
    showTooltip: vi.fn(),
    showCheckErrorNudge: vi.fn(),
    isTooltipFocus: () => false,
    setActiveElement: vi.fn(),
    getCorrectionCount: () => 0,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  });
}

describe("WritingSession", () => {
  it("debounce keeps latest only", async () => {
    vi.useFakeTimers();
    const el = makeElement();
    const sendCheck = vi.fn().mockResolvedValue({ success: true, data: {} });
    const session = makeSession({
      debounceMs: 200,
      sendCheck,
    });

    session.handleInput({ target: el });
    session.handleInput({ target: el });
    session.handleInput({ target: el });

    await vi.advanceTimersByTimeAsync(200);
    expect(sendCheck).toHaveBeenCalledTimes(1);
    expect(sendCheck).toHaveBeenCalledWith("hello world");
    vi.useRealTimers();
  });

  it("drops stale response via generation", async () => {
    const el = makeElement();
    let resolveFirst;
    const first = new Promise((r) => {
      resolveFirst = r;
    });
    const sendCheck = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({
        success: true,
        data: {
          corrected: "hello earth",
          changes: [{ original: "world", replacement: "earth", explanation: "word choice" }],
        },
      });
    const showTooltip = vi.fn();
    const getCorrectionCount = vi.fn().mockReturnValue(1);

    const session = makeSession({
      sendCheck,
      showTooltip,
      getCorrectionCount,
    });

    const p1 = session.checkGrammar(el);
    const p2 = session.checkGrammar(el);
    resolveFirst({ success: true, data: { id: 1 } });

    await p2;
    await p1;

    expect(getCorrectionCount).toHaveBeenCalledTimes(1);
    expect(getCorrectionCount).toHaveBeenCalledWith(
      {
        corrected: "hello earth",
        changes: [{ original: "world", replacement: "earth", explanation: "word choice" }],
      },
      "hello world",
    );
    expect(showTooltip).toHaveBeenCalledTimes(1);
    expect(showTooltip).toHaveBeenCalledWith(el, {
      corrected: "hello earth",
      changes: [{ original: "world", replacement: "earth", explanation: "word choice" }],
    });
  });

  it("dismissed element resumes after new input", async () => {
    const el = makeElement();
    const sendCheck = vi.fn().mockResolvedValue({ success: true, data: {} });
    const session = makeSession({ sendCheck });

    session.recordIgnore(el);
    await session.checkGrammar(el);
    expect(sendCheck).toHaveBeenCalledTimes(0);

    session.handleInput({ target: el });
    await session.checkGrammar(el);
    expect(sendCheck).toHaveBeenCalledTimes(1);
  });

  it("recordAppliedText prevents unchanged recheck", async () => {
    const el = makeElement();
    const sendCheck = vi.fn().mockResolvedValue({ success: true, data: {} });
    const session = makeSession({
      getTextFromElement: () => "fixed text",
      sendCheck,
    });

    session.recordAppliedText(el, "fixed text");
    await session.checkGrammar(el);
    expect(sendCheck).toHaveBeenCalledTimes(0);
  });

  it("skips tooltip when correction count is zero", async () => {
    const el = makeElement();
    const showTooltip = vi.fn();
    const getCorrectionCount = vi.fn().mockReturnValue(0);
    const data = { corrected: "hello world", changes: [] };
    const session = makeSession({
      sendCheck: vi.fn().mockResolvedValue({ success: true, data }),
      showTooltip,
      getCorrectionCount,
    });

    await session.checkGrammar(el);

    expect(getCorrectionCount).toHaveBeenCalledWith(data, "hello world");
    expect(showTooltip).not.toHaveBeenCalled();
  });

  it("deactivation clears timers and dismissed state", async () => {
    vi.useFakeTimers();
    const el = makeElement();
    const sendCheck = vi.fn().mockResolvedValue({ success: true, data: {} });
    const session = makeSession({ debounceMs: 200, sendCheck });

    session.recordIgnore(el);
    session.handleInput({ target: el });
    session.deactivate();

    await vi.advanceTimersByTimeAsync(200);
    expect(sendCheck).toHaveBeenCalledTimes(0);

    session.handleInput({ target: el });
    await vi.advanceTimersByTimeAsync(200);

    expect(sendCheck).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
