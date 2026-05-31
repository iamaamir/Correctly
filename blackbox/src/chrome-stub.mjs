function makeStorageArea() {
  const store = new Map();
  return {
    async get(keys) {
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, store.get(key)]));
      if (typeof keys === "string") return { [keys]: store.get(keys) };
      if (keys && typeof keys === "object") {
        return Object.fromEntries(
          Object.entries(keys).map(([key, fallback]) => [key, store.has(key) ? store.get(key) : fallback]),
        );
      }
      return Object.fromEntries(store.entries());
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) store.set(key, value);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    },
    _store: store,
  };
}

export function installChromeStub() {
  if (globalThis.chrome?.storage?.local) return globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: makeStorageArea(),
      session: makeStorageArea(),
      onChanged: { addListener() {} },
    },
    runtime: {
      sendMessage() {},
      onMessage: { addListener() {} },
    },
    tabs: {
      sendMessage: async () => undefined,
    },
    action: {
      setBadgeText: async () => undefined,
      setBadgeBackgroundColor: async () => undefined,
    },
  };
  return globalThis.chrome;
}
