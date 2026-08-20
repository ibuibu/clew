import { Folder, GitBranch } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type RepoEntry = { path: string; name: string; kind: "repo" | "worktree" };

type Match = { entry: RepoEntry; score: number; hits: number[] };

// fzf風の絞り込み。クエリの文字が順に現れれば一致とし、連続と単語の頭を加点する
function fuzzy(text: string, query: string): { score: number; hits: number[] } | null {
  if (!query) return { score: 0, hits: [] };
  const lower = text.toLowerCase();
  const hits: number[] = [];
  let score = 0;
  let from = 0;
  for (const char of query.toLowerCase()) {
    const at = lower.indexOf(char, from);
    if (at === -1) return null;
    if (at === from && hits.length > 0) score += 12;
    if (at === 0 || "/-_. ".includes(lower[at - 1])) score += 10;
    score += 10 - Math.min(at - from, 10);
    hits.push(at);
    from = at + 1;
  }
  return { score, hits };
}

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  const marked = new Set(hits);
  return (
    <>
      {[...text].map((char, i) =>
        marked.has(i) ? (
          <span key={i} className="font-bold text-accent">
            {char}
          </span>
        ) : (
          <span key={i}>{char}</span>
        ),
      )}
    </>
  );
}

export function RepoPicker({
  value,
  entries,
  onChange,
}: {
  value: string;
  entries: RepoEntry[];
  onChange: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [alignRight, setAlignRight] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

  // 絞り込みはパス全体に効かせる。表示名だけだとリポジトリ名で探せない
  const matches: Match[] = entries
    .flatMap((entry) => {
      const found = fuzzy(entry.name, query) ?? fuzzy(entry.path, query);
      if (!found) return [];
      // パス側で当たった場合は表示名に印を付けられないので位置は捨てる
      const hits = found.hits.every((i) => i < entry.name.length) ? found.hits : [];
      return [{ entry, score: found.score, hits }];
    })
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // 画面右端で開くとはみ出すので、その場合だけ右寄せにする
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

  const choose = (path: string) => {
    onChange(path);
    setOpen(false);
    setQuery("");
  };

  const current = entries.find((e) => e.path === value);
  const label = current?.name ?? (value ? (value.split("/").at(-1) ?? value) : "（リポジトリなし）");

  return (
    <div ref={rootRef} className="relative">
      <button
        className="inline-flex h-6 items-center gap-1 rounded-full border border-line bg-elevated px-2 text-xs hover:border-fg-subtle"
        title={value || "作業ディレクトリ"}
        onClick={() => {
          setOpen((v) => !v);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        {current?.kind === "worktree" ? <GitBranch size={12} /> : <Folder size={12} />}
        <span className="max-w-48 truncate">{label}</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className={`absolute bottom-full z-20 mb-1 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-elevated shadow-lg ${
            alignRight ? "right-0" : "left-0"
          }`}
        >
          <input
            ref={inputRef}
            className="w-full border-b border-line bg-transparent px-3 py-2 text-xs outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown" && matches.length > 0) {
                e.preventDefault();
                setCursor((c) => (c + 1) % matches.length);
              } else if (e.key === "ArrowUp" && matches.length > 0) {
                e.preventDefault();
                setCursor((c) => (c - 1 + matches.length) % matches.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                const hit = matches[cursor];
                if (hit) choose(hit.entry.path);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <ul className="max-h-64 overflow-y-auto py-1">
            {matches.length === 0 && (
              <li className="px-3 py-2 text-xs text-fg-subtle">見つからない</li>
            )}
            {matches.map((match, i) => (
              <li key={match.entry.path} ref={(el) => void (rowRefs.current[i] = el)}>
                <button
                  className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left ${
                    i === cursor ? "bg-hover" : ""
                  }`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(match.entry.path)}
                >
                  {match.entry.kind === "worktree" ? (
                    <GitBranch size={12} className="shrink-0 text-fg-subtle" />
                  ) : (
                    <Folder size={12} className="shrink-0 text-fg-subtle" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">
                      <Highlight text={match.entry.name} hits={match.hits} />
                    </span>
                    <span className="block truncate text-[10px] text-fg-subtle">
                      {match.entry.path}
                    </span>
                  </span>
                  {match.entry.path === value && (
                    <span className="shrink-0 text-[10px] text-accent">選択中</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
