const CACHES = {
  models: new Map(),
  availability: new Map(),
};

const TTL = {
  models: 5 * 60 * 1000,
  availability: 30 * 1000,
};

export function getCachedModels(providerId) {
  const cached = CACHES.models.get(providerId);
  if (cached && Date.now() - cached.timestamp < TTL.models) return cached.models;
  return null;
}

export function setCachedModels(providerId, models) {
  CACHES.models.set(providerId, { models, timestamp: Date.now() });
}

export function getCachedAvailability(providerId) {
  const cached = CACHES.availability.get(providerId);
  if (cached && Date.now() - cached.timestamp < TTL.availability) return cached.available;
  return null;
}

export function setCachedAvailability(providerId, available) {
  CACHES.availability.set(providerId, { available, timestamp: Date.now() });
}

export function clearProviderCache(providerId) {
  if (providerId) {
    CACHES.models.delete(providerId);
    CACHES.availability.delete(providerId);
  } else {
    CACHES.models.clear();
    CACHES.availability.clear();
  }
}
