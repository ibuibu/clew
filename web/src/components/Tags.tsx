import { Tag as TagIcon, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChatStore } from "../store";
import { send } from "../ws";

// 同じ名前なら常に同じ色になるよう、文字列から色相を決める
function hue(tag: string): number {
  let hash = 0;
  for (const char of tag) hash = (hash * 31 + char.codePointAt(0)!) % 360;
  return hash;
}

const tagStyle = (tag: string) => ({
  color: `hsl(${hue(tag)} 55% var(--tag-lightness))`,
  backgroundColor: `hsl(${hue(tag)} 60% 50% / var(--tag-bg-alpha))`,
});

export function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
      style={tagStyle(tag)}
    >
      <span className="truncate">{tag}</span>
      {onRemove && (
        <button className="shrink-0 opacity-60 hover:opacity-100" title="外す" onClick={onRemove}>
          <X size={10} />
        </button>
      )}
    </span>
  );
}

export function TagEditor({ sessionId, tags }: { sessionId: string; tags: string[] }) {
  const sessions = useChatStore((s) => s.sessions);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [alignRight, setAlignRight] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const known = [
    ...new Set(Object.values(sessions).flatMap((s) => s.meta.tags ?? [])),
  ].sort((a, b) => a.localeCompare(b));

  const typed = query.trim();
  const candidates = known.filter(
    (t) => !tags.includes(t) && t.toLowerCase().includes(typed.toLowerCase()),
  );
  const canCreate = typed.length > 0 && !known.includes(typed) && !tags.includes(typed);
  const rows: { label: string; value: string; isNew: boolean }[] = [
    ...candidates.map((t) => ({ label: t, value: t, isNew: false })),
    ...(canCreate ? [{ label: `「${typed}」を作成`, value: typed, isNew: true }] : []),
  ];

  useEffect(() => {
    setCursor(0);
  }, [query]);

  // 画面右端のピルから開くと左寄せでははみ出すので、その場合だけ右寄せにする
  useLayoutEffect(() => {
    if (!open || !popoverRef.current) return;
    setAlignRight(popoverRef.current.getBoundingClientRect().right > window.innerWidth - 8);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  const update = (next: string[]) => send({ type: "set_session_tags", sessionId, tags: next });
  const add = (tag: string) => {
    if (!tag || tags.includes(tag)) return;
    update([...tags, tag]);
    setQuery("");
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && rows.length > 0) {
      e.preventDefault();
      setCursor((c) => (c + 1) % rows.length);
    } else if (e.key === "ArrowUp" && rows.length > 0) {
      e.preventDefault();
      setCursor((c) => (c - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      add(rows[cursor]?.value ?? typed);
    } else if (e.key === "Backspace" && query === "" && tags.length > 0) {
      // Notionと同じで、空の状態のBackspaceは末尾のタグを消す
      update(tags.slice(0, -1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        className="inline-flex items-center gap-1 rounded-full border border-line bg-elevated px-2 py-0.5 text-xs text-fg-muted hover:border-fg-subtle"
        title="タグを付ける"
        onClick={() => {
          setOpen((v) => !v);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <TagIcon size={12} />
        {tags.length === 0 ? "タグ" : tags.length}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className={`absolute bottom-full z-20 mb-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-elevated p-2 shadow-lg ${
            alignRight ? "right-0" : "left-0"
          }`}
        >
          <div className="flex flex-wrap items-center gap-1">
            {tags.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                onRemove={() => update(tags.filter((t) => t !== tag))}
              />
            ))}
            <input
              ref={inputRef}
              className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-xs outline-none placeholder-fg-subtle"
              placeholder={tags.length === 0 ? "タグを検索または作成" : ""}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          {rows.length > 0 && (
            <ul className="mt-2 max-h-48 overflow-y-auto border-t border-line pt-1">
              {rows.map((row, i) => (
                <li key={row.label}>
                  <button
                    className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs ${
                      i === cursor ? "bg-hover" : ""
                    }`}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => add(row.value)}
                  >
                    {row.isNew ? (
                      <span className="text-fg-muted">{row.label}</span>
                    ) : (
                      <TagChip tag={row.value} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
