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

// Install-tab switching with FLIP height animation
(() => {
  const tabs = document.querySelector(".install-tabs");
  if (!tabs) return;

  const panels = tabs.querySelector(".tab-panels");
  const labels = tabs.querySelectorAll(".tab-bar label");
  const radios = tabs.querySelectorAll('[name="install-tab"]');

  function selectTab(id) {
    const radio = document.getElementById(id);
    if (!radio || radio.checked) return;

    updateTabAria(id);
    const oldHeight = panels.offsetHeight;
    radio.checked = true;

    if (reduceMotion.matches) return;

    panels.style.height = oldHeight + "px";
    panels.offsetHeight;
    const newHeight = panels.scrollHeight;
    if (oldHeight === newHeight) {
      panels.style.height = "";
      return;
    }
    panels.style.height = newHeight + "px";

    const onFinish = () => {
      panels.style.height = "";
      panels.removeEventListener("transitionend", onFinish);
      panels.removeEventListener("transitioncancel", onFinish);
    };
    panels.addEventListener("transitionend", onFinish);
    panels.addEventListener("transitioncancel", onFinish);
  }

  function updateTabAria(activeId) {
    for (const label of labels) {
      const isActive = label.getAttribute("for") === activeId;
      label.setAttribute("aria-selected", isActive ? "true" : "false");
      label.setAttribute("tabindex", isActive ? "0" : "-1");
    }
  }

  for (const label of labels) {
    label.addEventListener("click", (e) => {
      e.preventDefault();
      selectTab(label.getAttribute("for"));
    });
  }

  if (navigator.userAgent.includes("Firefox")) {
    selectTab("tab-firefox");
  }
})();
