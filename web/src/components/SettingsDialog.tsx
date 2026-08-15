import { useEffect, useRef } from "react";
import { useThemeStore, type Theme } from "../theme";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "🖥 システム" },
  { value: "light", label: "☀️ ライト" },
  { value: "dark", label: "🌙 ダーク" },
];

const choiceClass = (selected: boolean) =>
  `rounded-md border px-2.5 py-1.5 text-xs ${
    selected ? "border-accent text-accent" : "border-line text-fg-muted hover:border-fg-subtle"
  }`;

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  // showModal() でないと Esc とバックドロップが有効にならないので、open属性ではなくAPIで開閉する
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="m-auto w-80 rounded-xl border border-line bg-elevated p-0 text-fg backdrop:bg-black/40"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-bold">設定</h2>
        <button
          className="rounded px-2 py-0.5 text-fg-subtle hover:bg-hover"
          title="閉じる"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4">
        <section>
          <div className="mb-2 text-sm font-bold">テーマ</div>
          <div className="flex gap-1.5">
            {THEMES.map((t) => (
              <button
                key={t.value}
                className={choiceClass(theme === t.value)}
                onClick={() => setTheme(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </dialog>
  );
}
