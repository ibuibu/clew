import { create } from "zustand";

export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "claude-web-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function resolve(theme: Theme): "light" | "dark" {
  return theme === "system" ? (media.matches ? "dark" : "light") : theme;
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", resolve(theme) === "dark");
}

const stored = localStorage.getItem(STORAGE_KEY);
const initial: Theme =
  stored === "light" || stored === "dark" || stored === "system" ? stored : "system";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initial,
  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEY, theme);
    apply(theme);
    set({ theme });
  },
}));

// システム設定に追従する（theme === "system" のときだけ）
media.addEventListener("change", () => {
  if (useThemeStore.getState().theme === "system") apply("system");
});

export function initTheme() {
  apply(initial);
}
