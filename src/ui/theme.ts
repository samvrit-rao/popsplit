const KEY = "popsplit-theme";

export function initTheme(): void {
  document.documentElement.dataset.theme = preferredTheme();
}

export function toggleTheme(): void {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === "dark" ? "#101614" : "#e7f0ea");
  window.dispatchEvent(new Event("popsplit-theme"));
}

export function themeLabel(): string {
  return document.documentElement.dataset.theme === "dark" ? "Light" : "Dark";
}

function preferredTheme(): "light" | "dark" {
  try {
    if (localStorage.getItem(KEY) === "dark") return "dark";
  } catch {
    /* ignore */
  }
  return "light";
}
