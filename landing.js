const header = document.querySelector("[data-header]");
const backToTop = document.querySelector("[data-back-to-top]");

function updateHeaderState() {
  header?.toggleAttribute("data-scrolled", window.scrollY > 12);
}

updateHeaderState();
window.addEventListener("scroll", updateHeaderState, { passive: true });

backToTop?.addEventListener("click", (event) => {
  event.preventDefault();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
