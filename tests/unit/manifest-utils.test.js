import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadManifestForTarget, resolveBuildTarget } from "../../scripts/manifest-utils.mjs";

describe("manifest utils", () => {
  it("resolves chrome target output", () => {
    expect(resolveBuildTarget("chrome")).toEqual({
      manifestPatchPath: "manifest.chrome.patch.json",
      outputZip: "correctly-chrome.zip",
    });
  });

  it("resolves firefox target output", () => {
    expect(resolveBuildTarget("firefox")).toEqual({
      manifestPatchPath: "manifest.firefox.patch.json",
      outputZip: "correctly-firefox.xpi",
    });
  });

  it("loads merged chrome manifest", () => {
    const manifest = loadManifestForTarget("chrome");
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe("background/service-worker.js");
    expect(manifest.browser_specific_settings).toBeUndefined();
  });

  it("loads merged firefox manifest", () => {
    const manifest = loadManifestForTarget("firefox");
    expect(manifest.background.scripts).toEqual(["background/service-worker.js"]);
    expect(manifest.browser_specific_settings.gecko.id).toBe("correctly@mak.in");
    expect(manifest.browser_specific_settings.gecko.data_collection_permissions.required).toEqual(["none"]);
    expect(manifest.browser_specific_settings.gecko.data_collection_permissions.optional).toEqual([
      "technicalAndInteraction",
    ]);
    expect(manifest.background.service_worker).toBeUndefined();
  });

  it.each(["chrome", "firefox"])("all manifest paths reference existing files (%s)", (target) => {
    const manifest = loadManifestForTarget(target);
    const paths = [];

    if (manifest.background?.service_worker) paths.push(manifest.background.service_worker);
    if (manifest.background?.scripts) paths.push(...manifest.background.scripts);
    if (manifest.action?.default_popup) paths.push(manifest.action.default_popup);
    if (manifest.action?.default_icon) paths.push(...Object.values(manifest.action.default_icon));
    if (manifest.icons) paths.push(...Object.values(manifest.icons));
    if (manifest.content_scripts) {
      for (const cs of manifest.content_scripts) {
        if (cs.js) paths.push(...cs.js);
        if (cs.css) paths.push(...cs.css);
      }
    }
    if (manifest.declarative_net_request?.rule_resources) {
      for (const rr of manifest.declarative_net_request.rule_resources) {
        paths.push(rr.path);
      }
    }

    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(existsSync(p), `${p} does not exist`).toBe(true);
      expect(statSync(p).isFile(), `${p} is not a file`).toBe(true);
    }
  });

  it("applies version override", () => {
    const manifest = loadManifestForTarget("chrome", "9.9.9");
    expect(manifest.version).toBe("9.9.9");
  });
});
