import { BADGE_DURATION_ERROR, BADGE_DURATION_ISSUES, BADGE_DURATION_OK } from "../../lib/config.js";

export { BADGE_DURATION_ERROR, BADGE_DURATION_ISSUES, BADGE_DURATION_OK };

export function updateBadge(tabId, state) {
  const badges = {
    ready: { text: "", bg: "#2d7d46" },
    checking: { text: "...", bg: "#ff9800" },
    found: { text: "!", bg: "#c62828" },
    ok: { text: "✓", bg: "#2d7d46" },
    off: { text: "OFF", bg: "#999" },
    nokey: { text: "?", bg: "#e65100" },
    error: { text: "✗", bg: "#c62828" },
  };
  const badge = badges[state] || badges.ready;
  const opts = tabId ? { tabId } : {};
  chrome.action.setBadgeText({ text: badge.text, ...opts });
  chrome.action.setBadgeBackgroundColor({ color: badge.bg, ...opts });
}
