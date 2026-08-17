import { Bell, BellOff, Monitor, Moon, Sun, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { notifySupported, useNotifyStore } from "../notify";
import { useThemeStore, type Theme } from "../theme";

const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "システム", icon: Monitor },
  { value: "light", label: "ライト", icon: Sun },
  { value: "dark", label: "ダーク", icon: Moon },
];

const choiceClass = (selected: boolean) =>
  `flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
    selected ? "border-accent text-accent" : "border-line text-fg-muted hover:border-fg-subtle"
  }`;

function NotifySection() {
  const enabled = useNotifyStore((s) => s.enabled);
  const setEnabled = useNotifyStore((s) => s.setEnabled);

  if (!notifySupported) {
    return (
      <p className="text-xs text-fg-subtle">
        このブラウザでは通知を使えません。https か localhost で開く必要があります。
      </p>
    );
  }
  if (Notification.permission === "denied") {
    return (
      <p className="text-xs text-fg-subtle">
        ブラウザ側でブロックされています。サイトの権限設定から通知を許可してください。
      </p>
    );
  }

  return (
    <>
      <div className="flex gap-1.5">
        <button className={choiceClass(enabled)} onClick={() => void setEnabled(true)}>
          <Bell size={14} />
          オン
        </button>
        <button className={choiceClass(!enabled)} onClick={() => void setEnabled(false)}>
          <BellOff size={14} />
          オフ
        </button>
      </div>
      <p className="mt-2 text-xs text-fg-subtle">
        タブが非表示、またはフォーカスが外れているときに、完了・承認待ち・質問を通知します。
      </p>
    </>
  );
}

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
          className="rounded p-1 text-fg-subtle hover:bg-hover"
          title="閉じる"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4">
        <section>
          <div className="mb-2 text-sm font-bold">テーマ</div>
          <div className="flex gap-1.5">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                className={choiceClass(theme === value)}
                onClick={() => setTheme(value)}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 text-sm font-bold">デスクトップ通知</div>
          <NotifySection />
        </section>
      </div>
    </dialog>
  );
}
