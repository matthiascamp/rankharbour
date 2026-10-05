const menu = document.querySelector(".menu-toggle");
const nav = document.querySelector("#site-navigation");
function closeMenu() {
  nav.classList.remove("is-open");
  menu.setAttribute("aria-expanded", "false");
}
menu.addEventListener("click", () => {
  const open = menu.getAttribute("aria-expanded") !== "true";
  menu.setAttribute("aria-expanded", String(open));
  nav.classList.toggle("is-open", open);
});
nav.addEventListener("click", (e) => {
  if (e.target.closest("a")) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menu.getAttribute("aria-expanded") === "true") {
    closeMenu();
    menu.focus();
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".site-header")) closeMenu();
});
document.querySelector("#website-start").addEventListener("submit", (e) => {
  e.preventDefault();
  const field = document.querySelector("#website-url");
  const error = document.querySelector("#website-error");
  try {
    const raw = field.value.trim();
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : "https://" + raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname.includes(".") ||
      url.username ||
      url.password
    )
      throw new Error();
    const target = new URL("account.html", location.href);
    target.searchParams.set("tab", "seo");
    target.searchParams.set("website", url.href);
    location.assign(target.href);
  } catch {
    error.textContent = "Enter a website address, such as example.com.au.";
    field.focus();
  }
});
