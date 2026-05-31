import { readFileSync } from "node:fs";

export const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

export const deepMerge = (base, patch) => {
  const out = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = out[key];
    out[key] = isPlainObject(baseValue) && isPlainObject(patchValue) ? deepMerge(baseValue, patchValue) : patchValue;
  }
  return out;
};

export const resolveBuildTarget = (target = "chrome") => ({
  manifestPatchPath: target === "firefox" ? "manifest.firefox.patch.json" : "manifest.chrome.patch.json",
  outputZip: target === "firefox" ? "correctly-firefox.xpi" : "correctly-chrome.zip",
});

export const loadManifestForTarget = (target = "chrome", versionOverride = null) => {
  const { manifestPatchPath } = resolveBuildTarget(target);
  const manifestBase = JSON.parse(readFileSync("manifest.base.json", "utf8"));
  const manifestPatch = JSON.parse(readFileSync(manifestPatchPath, "utf8"));
  const manifest = deepMerge(manifestBase, manifestPatch);
  if (target === "firefox") {
    delete manifest.background.service_worker;
    delete manifest.declarative_net_request;
  }
  if (versionOverride) manifest.version = versionOverride;
  return manifest;
};
