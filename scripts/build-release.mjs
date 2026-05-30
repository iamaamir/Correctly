import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const versionArg = process.argv.find((arg) => arg.startsWith("--version="));
const versionOverride = versionArg ? versionArg.slice("--version=".length) : null;

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
if (versionOverride) manifest.version = versionOverride;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

rmSync("dist", { recursive: true, force: true });
rmSync("correctly.zip", { force: true });

mkdirSync("dist/correctly", { recursive: true });
writeFileSync("dist/correctly/manifest.json", JSON.stringify(manifest));

cpSync("background", "dist/correctly/background", { recursive: true });
cpSync("content", "dist/correctly/content", { recursive: true });
cpSync("popup", "dist/correctly/popup", { recursive: true });
cpSync("lib", "dist/correctly/lib", { recursive: true });
cpSync("providers", "dist/correctly/providers", { recursive: true });
mkdirSync("dist/correctly/icons", { recursive: true });
cpSync("icons/icon16.png", "dist/correctly/icons/icon16.png");
cpSync("icons/icon48.png", "dist/correctly/icons/icon48.png");
cpSync("icons/icon128.png", "dist/correctly/icons/icon128.png");

run("npx", [
  "esbuild",
  "dist/correctly/background/service-worker.js",
  "--minify",
  "--bundle",
  "--format=esm",
  "--allow-overwrite",
  "--outfile=dist/correctly/background/service-worker.js",
]);
run("bash", [
  "-lc",
  "find dist/correctly -type f -name '*.js' ! -path '*/background/service-worker.js' -print0 | xargs -0 -I{} npx esbuild {} --minify --legal-comments=none --allow-overwrite --outfile={}",
]);
run("bash", [
  "-lc",
  "find dist/correctly -type f -name '*.css' -print0 | xargs -0 -I{} npx esbuild {} --minify --legal-comments=none --allow-overwrite --outfile={}",
]);
run("npx", [
  "html-minifier-terser",
  "--collapse-whitespace",
  "--remove-comments",
  "--remove-optional-tags",
  "--remove-attribute-quotes",
  "--remove-redundant-attributes",
  "--remove-script-type-attributes",
  "--remove-style-link-type-attributes",
  "--use-short-doctype",
  "--minify-css",
  "true",
  "--minify-js",
  "false",
  "--input-dir",
  "dist/correctly/popup",
  "--output-dir",
  "dist/correctly/popup",
  "--file-ext",
  "html",
]);
run("bash", [
  "-lc",
  "jq -c . dist/correctly/background/dnr-rules.json > dist/correctly/background/dnr-rules.json.tmp && mv dist/correctly/background/dnr-rules.json.tmp dist/correctly/background/dnr-rules.json",
]);
run("bash", ["-lc", "find dist/correctly -type f -name '*.js' -print0 | xargs -0 -I{} node --check {}"]);
run("bash", ["-lc", "cd dist/correctly && zip -X -9 -D -r ../../correctly.zip ."]);
