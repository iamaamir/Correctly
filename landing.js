const header = document.querySelector("[data-header]");
const backToTop = document.querySelector("[data-back-to-top]");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const revealGroups = [
  ".hero-copy .eyebrow",
  ".hero-copy h1",
  ".hero-lede",
  ".hero-actions",
  ".hero-points",
  ".hero-visual",
  ".typed-copy",
  ".suggestion-popover",
  ".section-heading",
  ".feature-grid article",
  ".provider-matrix article",
  ".privacy-layout",
  ".final-cta",
];

function updateHeaderState() {
  header?.toggleAttribute("data-scrolled", window.scrollY > 12);
}

function setupMotion() {
  const revealItems = revealGroups.flatMap((selector) => [...document.querySelectorAll(selector)]);

  if (revealItems.length === 0 || reduceMotion.matches) {
    for (const item of revealItems) {
      item.classList.add("is-visible");
    }
    return;
  }

  document.documentElement.classList.add("motion-ready");

  for (const [index, item] of revealItems.entries()) {
    item.dataset.reveal = "";
    item.style.setProperty("--reveal-delay", `${Math.min(index * 48, 240)}ms`);
  }

  const reveal = (item) => item.classList.add("is-visible");
  const heroItems = revealItems.filter((item) => item.closest(".hero"));
  const scrollItems = revealItems.filter((item) => !item.closest(".hero"));

  requestAnimationFrame(() => {
    for (const item of heroItems) {
      reveal(item);
    }
  });

  if (!("IntersectionObserver" in window)) {
    for (const item of scrollItems) {
      reveal(item);
    }
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }

        reveal(entry.target);
        observer.unobserve(entry.target);
      }
    },
    {
      rootMargin: "0px 0px -12% 0px",
      threshold: 0.16,
    },
  );

  for (const item of scrollItems) {
    observer.observe(item);
  }
}

updateHeaderState();
setupMotion();
window.addEventListener("scroll", updateHeaderState, { passive: true });

backToTop?.addEventListener("click", (event) => {
  event.preventDefault();
  window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
});

// Install-tab switching
(() => {
  const tabsRoot = document.querySelector("[data-install-tabs]");
  if (!tabsRoot) return;

  const tabBar = tabsRoot.querySelector("[role='tablist']");
  const tabs = [...tabsRoot.querySelectorAll("[role='tab']")];
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));
  const tabPanels = tabsRoot.querySelector(".tab-panels");
  const transitionStyleId = "install-tab-view-transition";
  const transitionStyle = `
::view-transition-group(tab-panel) {
  animation-timing-function: cubic-bezier(0.68, -0.6, 0.32, 1.6);
  animation-duration: 0.6s;
}

::view-transition-old(tab-panel) {
  animation-name: tab-out;
}

::view-transition-new(tab-panel) {
  animation-name: tab-in;
}

::view-transition-old(tab-panel),
::view-transition-new(tab-panel) {
  height: 100%;
  object-fit: none;
  clip-path: inset(0);
}

@keyframes tab-out {
  to {
    opacity: 0;
    transform: translateY(-30px);
  }
}

@keyframes tab-in {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
}`;

  function ensureTransitionStyle() {
    if (document.getElementById(transitionStyleId)) {
      return;
    }

    const style = document.createElement("style");
    style.id = transitionStyleId;
    style.textContent = transitionStyle;
    document.head.append(style);
  }

  function applyTab(selectedTab) {
    for (const tab of tabs) {
      const isSelected = tab === selectedTab;
      tab.setAttribute("aria-selected", isSelected ? "true" : "false");
      tab.setAttribute("tabindex", isSelected ? "0" : "-1");
    }

    for (const panel of panels) {
      if (!panel) continue;
      panel.hidden = panel.id !== selectedTab.getAttribute("aria-controls");
    }
  }

  function selectTab(selectedTab, { focus = false } = {}) {
    if (!selectedTab || selectedTab.getAttribute("aria-selected") === "true") {
      if (focus) selectedTab?.focus();
      return;
    }

    const changeTab = () => applyTab(selectedTab);

    if (document.startViewTransition && tabPanels && !reduceMotion.matches) {
      ensureTransitionStyle();
      tabPanels.style.viewTransitionName = "tab-panel";
      const transition = document.startViewTransition(changeTab);
      transition.finished.finally(() => {
        tabPanels.style.viewTransitionName = "";
        if (focus) selectedTab.focus();
      });
      return;
    }

    changeTab();
    if (focus) selectedTab.focus();
  }

  tabBar?.addEventListener("click", (event) => {
    const selectedTab = event.target.closest("[role='tab']");
    if (!selectedTab) return;
    selectTab(selectedTab);
  });

  tabBar?.addEventListener("keydown", (event) => {
    const currentIndex = tabs.indexOf(event.target);
    if (currentIndex === -1) return;

    const keyMoves = {
      ArrowLeft: currentIndex - 1,
      ArrowUp: currentIndex - 1,
      ArrowRight: currentIndex + 1,
      ArrowDown: currentIndex + 1,
      Home: 0,
      End: tabs.length - 1,
    };

    if (!(event.key in keyMoves)) {
      return;
    }

    event.preventDefault();
    const nextIndex = (keyMoves[event.key] + tabs.length) % tabs.length;
    selectTab(tabs[nextIndex], { focus: true });
  });

  if (navigator.userAgent.includes("Firefox")) {
    selectTab(document.getElementById("tab-firefox"));
  }
})();
