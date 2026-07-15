import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const css = readFileSync("landing.css", "utf8").trimEnd();

const inlineCssMatch = html.match(
  /<!-- Inline landing\.css to avoid a render-blocking stylesheet request on the static landing page\. -->\s*<style>\n([\s\S]*?)\n\s*<\/style>/,
);

if (!inlineCssMatch) {
  console.error("Could not find the inline landing.css <style> block in index.html.");
  process.exit(1);
}

const inlineCss = inlineCssMatch[1].trimEnd();

if (inlineCss !== css) {
  console.error("Inline landing CSS in index.html is out of sync with landing.css.");
  console.error("Update index.html after editing landing.css.");
  process.exit(1);
}

console.log("Inline landing CSS matches landing.css.");
