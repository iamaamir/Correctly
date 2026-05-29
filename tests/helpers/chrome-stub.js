import { vi } from "vitest";

export function createChromeStub() {
  const localStore = new Map();
  const sessionStore = new Map();

  function makeStorageArea(store) {
    return {
      get: vi.fn(async (keys) => {
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((key) => [key, store.get(key)]));
        }
        if (typeof keys === "string") {
          return { [keys]: store.get(keys) };
        }
        if (keys && typeof keys === "object") {
          return Object.fromEntries(
            Object.entries(keys).map(([key, fallback]) => [key, store.has(key) ? store.get(key) : fallback]),
          );
        }
        return Object.fromEntries(store.entries());
      }),
      set: vi.fn(async (values) => {
        for (const [key, value] of Object.entries(values)) store.set(key, value);
      }),
      remove: vi.fn(async (keys) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
      }),
      _store: store,
    };
  }

  return {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
    },
    storage: {
      local: makeStorageArea(localStore),
      session: makeStorageArea(sessionStore),
      onChanged: { addListener: vi.fn() },
    },
    tabs: {
      sendMessage: vi.fn(async () => undefined),
      query: vi.fn(async () => []),
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
  };
}
