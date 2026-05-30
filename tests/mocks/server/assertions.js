export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertCallCountAtLeast(calls, n, label = "calls") {
  if ((calls?.length || 0) < n) {
    throw new Error(`expected at least ${n} ${label}, got ${calls?.length || 0}`);
  }
}

export function assertAnyCall(calls, predicate, message) {
  if (!calls?.some(predicate)) {
    throw new Error(message || "expected matching call not found");
  }
}
