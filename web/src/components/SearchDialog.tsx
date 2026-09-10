import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cwdLabel } from "../cwd";
import { searchSessions, type SearchHit } from "../search";
import { useChatStore, type ChatItem } from "../store";

const KIND_LABEL: Partial<Record<ChatItem["kind"], string>> = {
  user: "あなた",
  text: "返答",
  thinking: "思考",
  bash: "bash",
  toolError: "エラー",
};

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const sessions = useChatStore((s) => s.sessions);
  const order = useChatStore((s) => s.order);
  const jumpTo = useChatStore((s) => s.jumpTo);

  const hits = useMemo(() => searchSessions(sessions, order, query), [sessions, order, query]);

  // showModal() でないと Esc とバックドロップが有効にならないので、open属性ではなくAPIで開閉する
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const go = (hit: SearchHit) => {
    jumpTo(hit.sessionId, hit.itemId);
    onClose();
  };

  return (
    <dialog
      ref={ref}
      className="mx-auto mt-[8vh] w-[min(46rem,92vw)] rounded-xl border border-line bg-elevated p-0 text-fg backdrop:bg-black/40"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <Search size={16} className="shrink-0 text-fg-subtle" />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
          placeholder="すべてのセッションを検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(hits.length - 1, i + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(0, i - 1));
            }
            if (e.key === "Enter" && hits[selected]) {
              e.preventDefault();
              go(hits[selected]);
            }
          }}
        />
        <span className="shrink-0 text-[11px] text-fg-subtle">{hits.length} 件</span>
        <button
          className="shrink-0 rounded p-1 text-fg-subtle hover:bg-hover"
          title="閉じる"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
        {query.trim() && hits.length === 0 && (
          <div className="px-3.5 py-6 text-center text-sm text-fg-subtle">見つかりません</div>
        )}
        {hits.map((hit, i) => {
          const meta = sessions[hit.sessionId]?.meta;
          return (
            <button
              key={`${hit.sessionId}:${hit.itemId}`}
              data-selected={i === selected}
              className={`flex w-full flex-col gap-0.5 border-b border-line px-3.5 py-2 text-left ${
                i === selected ? "bg-hover" : "hover:bg-hover"
              }`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => go(hit)}
            >
              <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                <span className="truncate">{meta?.title || "（無題）"}</span>
                {meta && <span className="shrink-0">· {cwdLabel(meta.cwd)}</span>}
                <span className="shrink-0">· {KIND_LABEL[hit.kind] ?? hit.kind}</span>
              </div>
              <div className="line-clamp-2 text-[13px] text-fg-muted">
                {hit.before}
                <mark className="rounded bg-accent/25 px-0.5 text-fg">{hit.match}</mark>
                {hit.after}
              </div>
            </button>
          );
        })}
      </div>
    </dialog>
  );
}
