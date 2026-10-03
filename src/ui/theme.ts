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
  window.dispatchEvent(new Event("popsplit-theme"));
}

export function themeLabel(): string {
  return document.documentElement.dataset.theme === "dark" ? "Light" : "Dark";
}

function preferredTheme(): "light" | "dark" {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
