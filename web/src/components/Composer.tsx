import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SlashCommandInfo } from "@clew/shared";
import { submitKeyLabel } from "../platform";
import { useActiveSession, useChatStore } from "../store";
import { send } from "../ws";
import { SessionBar, cwdRef, modelRef, permModeRef } from "./SessionBar";

// cwdごとのコマンド一覧。サーバー側でもキャッシュしているが、メニューを開くたびの往復を避ける
const commandCache = new Map<string, SlashCommandInfo[]>();

const MAX_ROWS = 10;

// 入力欄は1行から始めて、MAX_ROWS行までは内容に合わせて伸ばし、超えたらスクロールさせる
function resize(el: HTMLTextAreaElement) {
  const style = getComputedStyle(el);
  const frame =
    el.offsetHeight - el.clientHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const max = parseFloat(style.lineHeight) * MAX_ROWS + frame;
  // 内容が減ったときに縮められるよう、測る前に一度リセットする
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
}

// カーソル直前が「単語の先頭にある / + まだ引数を打っていない文字列」ならメニューを出す
const slashQuery = (text: string, caret: number) => {
  const m = /(?:^|\s)\/([\w:-]*)$/.exec(text.slice(0, caret));
  if (!m) return null;
  return { query: m[1], start: caret - m[1].length - 1 };
};

const matches = (commands: SlashCommandInfo[], q: string) => {
  const lower = q.toLowerCase();
  const names = (c: SlashCommandInfo) => [c.name, ...(c.aliases ?? [])];
  const hit = commands.filter((c) => names(c).some((n) => n.toLowerCase().includes(lower)));
  // 前方一致を優先して並べる
  return hit.sort((a, b) => {
    const rank = (c: SlashCommandInfo) =>
      names(c).some((n) => n.toLowerCase().startsWith(lower)) ? 0 : 1;
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
};

export function Composer() {
  const [commands, setCommands] = useState<SlashCommandInfo[]>([]);
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [caret, setCaret] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  // コマンド挿入後にキャレットを置きたい位置。再レンダリング後に反映する
  const pendingCaret = useRef<number | null>(null);
  const connected = useChatStore((s) => s.connected);
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const session = useActiveSession();
  const isRunning = session?.isRunning ?? false;

  const draftKey = activeId ?? "";
  const text = useChatStore((s) => s.drafts[draftKey] ?? "");
  const setDraft = useChatStore((s) => s.setDraft);
  const setText = (v: string) => setDraft(draftKey, v);

  useLayoutEffect(() => {
    if (textareaRef.current) resize(textareaRef.current);
  }, [text]);

  const cwd = session?.meta.cwd ?? cwdRef.current;
  const slash = slashQuery(text, caret);
  const typingCommand = slash !== null;
  const candidates = slash ? matches(commands, slash.query) : [];
  const menuOpen = candidates.length > 0 && !dismissed;

  // メニューを出す状況になって初めて一覧を取りに行く（cwdが確定してからでないと正しい一覧が得られない）
  useEffect(() => {
    if (!typingCommand) return;
    const cached = commandCache.get(cwd);
    if (cached) {
      setCommands(cached);
      return;
    }
    let cancelled = false;
    fetch(`/api/commands?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((list: SlashCommandInfo[]) => {
        commandCache.set(cwd, list);
        if (!cancelled) setCommands(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [typingCommand, cwd]);

  useEffect(() => {
    const onShortcut = (e: KeyboardEvent) => {
      // e.key はShift併用や配列違いで揺れるため、物理キーで判定する
      if (e.code !== "KeyO" || !e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setActive(null);
      textareaRef.current?.focus();
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [setActive]);

  useEffect(() => {
    setCursor(0);
  }, [slash?.query]);

  useEffect(() => {
    itemRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor, menuOpen]);

  useEffect(() => {
    if (pendingCaret.current === null) return;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    textareaRef.current?.setSelectionRange(pos, pos);
    setCaret(pos);
  }, [text]);

  const syncCaret = (e: { currentTarget: HTMLTextAreaElement }) => {
    setCaret(e.currentTarget.selectionStart);
  };

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || !connected) return;
    if (activeId) {
      send({ type: "user_message", sessionId: activeId, text: trimmed });
    } else {
      // ドラフト状態: SessionBarの選択を使って新規セッションを作成する
      send({
        type: "user_message",
        text: trimmed,
        cwd: cwdRef.current || undefined,
        permissionMode: permModeRef.current,
        model: modelRef.current || undefined,
      });
    }
    setText("");
    setCaret(0);
  };

  const pick = (command: SlashCommandInfo) => {
    if (!slash) return;
    const inserted = `/${command.name} `;
    setText(text.slice(0, slash.start) + inserted + text.slice(caret));
    pendingCaret.current = slash.start + inserted.length;
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => (c + 1) % candidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => (c - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        pick(candidates[cursor]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <footer className="border-t border-line bg-panel">
      <div className="mx-auto w-full max-w-4xl px-4 py-3">
        <SessionBar />
        <div className="relative flex gap-2">
          {menuOpen && (
            <ul className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-elevated py-1 shadow-lg">
              {candidates.map((c, i) => (
                <li key={c.name} ref={(el) => void (itemRefs.current[i] = el)}>
                  <button
                    className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${
                      i === cursor ? "bg-hover" : ""
                    }`}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => pick(c)}
                  >
                    <span className="shrink-0 font-mono">/{c.name}</span>
                    {c.argumentHint && (
                      <span className="shrink-0 font-mono text-xs text-fg-muted">
                        {c.argumentHint}
                      </span>
                    )}
                    <span className="truncate text-xs text-fg-muted">{c.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-line bg-elevated px-3 py-2.5 text-sm"
            placeholder={
              activeId
                ? `Claude Codeへの指示を入力… (${submitKeyLabel}で送信)`
                : `新しいセッションを開始… (${submitKeyLabel}で送信)`
            }
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart);
              setDismissed(false);
            }}
            onSelect={syncCaret}
            onKeyDown={onKeyDown}
          />
          {isRunning && activeId ? (
            <button
              className="rounded-lg border border-line px-4 text-sm hover:bg-hover"
              onClick={() => send({ type: "interrupt", sessionId: activeId })}
            >
              中断
            </button>
          ) : (
            <button
              className="rounded-lg bg-accent px-4 text-sm text-white hover:opacity-90 disabled:opacity-50"
              disabled={!connected}
              onClick={submit}
            >
              送信
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}
