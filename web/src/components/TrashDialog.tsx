import { RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TRASH_TTL_MS } from "@clew/shared";
import { cwdLabel } from "../cwd";
import { useChatStore } from "../store";
import { send } from "../ws";

// 本削除までの目安。粒度は荒くていいので一番大きい単位だけ出す
function untilPurge(deletedAt: number): string {
  const mins = Math.round((deletedAt + TRASH_TTL_MS - Date.now()) / 60_000);
  if (mins <= 0) return "まもなく本削除";
  if (mins < 60) return `あと${mins}分で本削除`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `あと${hours}時間で本削除` : `あと${Math.round(hours / 24)}日で本削除`;
}

export function TrashDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const trash = useChatStore((s) => s.trash);
  // 完全に削除する前に一段確認を挟む。対象のセッションid
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);

  // showModal() でないと Esc とバックドロップが有効にならないので、open属性ではなくAPIで開閉する
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setConfirming(null);
      setConfirmingAll(false);
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="mx-auto mt-[8vh] w-[min(40rem,92vw)] rounded-xl border border-line bg-elevated p-0 text-fg backdrop:bg-black/40"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <Trash2 size={16} className="shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 text-sm font-bold">ゴミ箱</span>
        <span className="shrink-0 text-[11px] text-fg-subtle">{trash.length} 件</span>
        {trash.length > 0 &&
          (confirmingAll ? (
            <button
              className="shrink-0 rounded bg-danger px-2 py-0.5 text-[11px] font-bold text-app hover:opacity-90"
              onClick={() => {
                send({ type: "empty_trash" });
                setConfirmingAll(false);
              }}
            >
              すべて削除
            </button>
          ) : (
            <button
              className="shrink-0 rounded px-2 py-0.5 text-[11px] text-fg-subtle hover:bg-hover hover:text-danger"
              onClick={() => setConfirmingAll(true)}
            >
              空にする
            </button>
          ))}
        <button
          className="shrink-0 rounded p-1 text-fg-subtle hover:bg-hover"
          title="閉じる"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {trash.length === 0 && (
          <div className="px-3.5 py-6 text-center text-sm text-fg-subtle">ゴミ箱は空です</div>
        )}
        {trash.map((item) => {
          const id = item.meta.sessionId;
          return (
            <div
              key={id}
              className="flex items-center gap-2 border-b border-line px-3.5 py-2"
              onMouseLeave={() => setConfirming((cur) => (cur === id ? null : cur))}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{item.meta.title || "（無題）"}</div>
                <div className="truncate text-[11px] text-fg-subtle">
                  {[cwdLabel(item.meta.cwd), untilPurge(item.deletedAt)].join(" · ")}
                </div>
              </div>
              <button
                className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] text-fg-muted hover:bg-hover hover:text-fg"
                title="復元する"
                onClick={() => {
                  send({ type: "restore_session", sessionId: id });
                  onClose();
                }}
              >
                <RotateCcw size={13} />
                復元
              </button>
              {confirming === id ? (
                <button
                  className="shrink-0 rounded bg-danger px-2 py-0.5 text-[11px] font-bold text-app hover:opacity-90"
                  onClick={() => send({ type: "purge_session", sessionId: id })}
                >
                  完全に削除
                </button>
              ) : (
                <button
                  className="shrink-0 rounded p-1 text-fg-subtle hover:bg-hover hover:text-danger"
                  title="完全に削除"
                  onClick={() => setConfirming(id)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </dialog>
  );
}
