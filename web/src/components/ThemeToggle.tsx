import { useThemeStore, type Theme } from "../theme";

const CYCLE: Theme[] = ["system", "light", "dark"];
const LABEL: Record<Theme, { icon: string; text: string }> = {
  system: { icon: "🖥", text: "システム" },
  light: { icon: "☀️", text: "ライト" },
  dark: { icon: "🌙", text: "ダーク" },
};

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length];

  return (
    <button
      className="rounded-md border border-line px-2 py-1.5 text-sm hover:bg-hover"
      title={`テーマ: ${LABEL[theme].text} → ${LABEL[next].text}`}
      onClick={() => setTheme(next)}
    >
      {LABEL[theme].icon}
    </button>
  );
}
