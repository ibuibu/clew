import { CornerDownLeft, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SlashCommandInfo } from "@clew/shared";
import { useActiveSession, useChatStore } from "../store";
import { send } from "../ws";
import { SessionBar, cwdRef, modelRef, permModeRef } from "./SessionBar";

// cwdごとのコマンド一覧。サーバー側でもキャッシュしているが、メニューを開くたびの往復を避ける
const commandCache = new Map<string, SlashCommandInfo[]>();

const MAX_ROWS = 10;
const INDENT = "  ";
// 表示用の中黒。送信時にmarkdownの "- " へ戻す
const BULLET = "•";
const LIST_LINE = new RegExp(`^(\\s*)(${BULLET}|\\d+\\.) ?(.*)$`);

const lineRange = (text: string, caret: number) => {
  const start = text.lastIndexOf("\n", caret - 1) + 1;
  const end = text.indexOf("\n", caret);
  return { start, end: end === -1 ? text.length : end };
};

type Edit = { text: string; caret: number };

// 行頭で「- 」「* 」を打った瞬間に中黒へ置き換える
function bulletize(text: string, caret: number): Edit | null {
  const { start } = lineRange(text, caret);
  const typed = text.slice(start, caret);
  if (!/^\s*[-*] $/.test(typed)) return null;
  return { text: text.slice(0, caret - 2) + `${BULLET} ` + text.slice(caret), caret };
}

// 箇条書きの行で改行したら、同じ記号を継ぐ。空の項目なら1段戻して抜ける
function continueList(text: string, caret: number): Edit | null {
  const { start, end } = lineRange(text, caret);
  const match = LIST_LINE.exec(text.slice(start, end));
  if (!match) return null;
  const [, indent, marker, content] = match;

  if (!content.trim()) {
    const outdented = indent.length >= INDENT.length ? `${indent.slice(INDENT.length)}${marker} ` : "";
    return { text: text.slice(0, start) + outdented + text.slice(end), caret: start + outdented.length };
  }
  const next = marker === BULLET ? marker : `${parseInt(marker, 10) + 1}.`;
  const inserted = `\n${indent}${next} `;
  return { text: text.slice(0, caret) + inserted + text.slice(caret), caret: caret + inserted.length };
}

function indentList(text: string, caret: number, outdent: boolean): Edit | null {
  const { start, end } = lineRange(text, caret);
  const line = text.slice(start, end);
  if (!LIST_LINE.test(line)) return null;
  if (outdent) {
    if (!line.startsWith(INDENT)) return null;
    return {
      text: text.slice(0, start) + line.slice(INDENT.length) + text.slice(end),
      caret: caret - INDENT.length,
    };
  }
  return { text: text.slice(0, start) + INDENT + text.slice(start), caret: caret + INDENT.length };
}

const toMarkdown = (text: string) => text.replace(new RegExp(`^(\\s*)${BULLET} `, "gm"), "$1- ");

type Attachment = { url: string; name: string };

async function upload(file: File): Promise<Attachment> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body });
  const json = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !json.url) throw new Error(json.error || "アップロードに失敗しました");
  return { url: json.url, name: file.name || "画像" };
}

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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
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

  // 添付は下書きと違ってセッションごとに持たないので、切り替えたら捨てる
  useEffect(() => {
    setAttachments([]);
    setUploadError("");
  }, [activeId]);

  // 新規セッション（ドラフト）を開いたら、すぐ書き始められるようにする
  useEffect(() => {
    if (activeId === null) textareaRef.current?.focus();
  }, [activeId]);

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

  const addFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setUploadError("");
    const results = await Promise.allSettled(images.map(upload));
    const added = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failed = results.find((r) => r.status === "rejected");
    if (added.length > 0) setAttachments((prev) => [...prev, ...added]);
    if (failed) setUploadError(String((failed.reason as Error).message));
  };

  const applyEdit = (edit: Edit) => {
    setText(edit.text);
    pendingCaret.current = edit.caret;
  };

  const submit = () => {
    const trimmed = toMarkdown(text).trim();
    const images = attachments.map((a) => a.url);
    if ((!trimmed && images.length === 0) || !connected) return;
    if (activeId) {
      send({ type: "user_message", sessionId: activeId, text: trimmed, images });
    } else {
      // ドラフト状態: SessionBarの選択を使って新規セッションを作成する
      send({
        type: "user_message",
        text: trimmed,
        images,
        cwd: cwdRef.current || undefined,
        permissionMode: permModeRef.current,
        model: modelRef.current || undefined,
      });
    }
    setText("");
    setCaret(0);
    setAttachments([]);
    setUploadError("");
  };

  const pick = (command: SlashCommandInfo) => {
    if (!slash) return;
    const inserted = `/${command.name} `;
    setText(text.slice(0, slash.start) + inserted + text.slice(caret));
    pendingCaret.current = slash.start + inserted.length;
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IMEの変換確定のEnterは送信にも箇条書きにも使わない
    if (e.nativeEvent.isComposing) return;

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
      if (e.key === "Tab" || e.key === "Enter") {
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

    const pos = e.currentTarget.selectionStart;
    const hasSelection = pos !== e.currentTarget.selectionEnd;

    if (e.key === "Enter") {
      // Shift+Enterが改行。素のEnterとCmd/Ctrl+Enterは送信
      if (!e.shiftKey) {
        e.preventDefault();
        submit();
        return;
      }
      if (!hasSelection) {
        const edit = continueList(text, pos);
        if (edit) {
          e.preventDefault();
          applyEdit(edit);
        }
      }
      return;
    }
    if (e.key === "Tab") {
      const edit = indentList(text, pos, e.shiftKey);
      if (edit) {
        e.preventDefault();
        applyEdit(edit);
      }
    }
  };

  return (
    <footer className="border-t border-line bg-panel">
      <div className="mx-auto w-full max-w-4xl px-4 py-3">
        <SessionBar />
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div key={a.url} className="group relative">
                <img
                  src={a.url}
                  alt={a.name}
                  title={a.name}
                  className="h-16 w-16 rounded-lg border border-line object-cover"
                />
                <button
                  className="absolute -right-1.5 -top-1.5 hidden rounded-full border border-line bg-elevated p-0.5 text-fg-muted hover:text-danger group-hover:block"
                  title="添付を外す"
                  onClick={() => setAttachments((prev) => prev.filter((p) => p.url !== a.url))}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {uploadError && <div className="mb-2 text-xs text-danger">{uploadError}</div>}
        <div
          className={`relative flex gap-2 rounded-lg ${dragging ? "outline-2 outline-dashed outline-accent" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void addFiles([...e.dataTransfer.files]);
          }}
        >
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
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              rows={1}
              className="w-full resize-none rounded-lg border border-line bg-elevated py-2.5 pl-3 pr-11 text-sm"
              value={text}
              onChange={(e) => {
                const bulleted = bulletize(e.target.value, e.target.selectionStart);
                if (bulleted) applyEdit(bulleted);
                else setText(e.target.value);
                setCaret(e.target.selectionStart);
                setDismissed(false);
              }}
              onSelect={syncCaret}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                const files = [...e.clipboardData.files];
                // 画像を貼ったときだけ添付にする（テキストの貼り付けは邪魔しない）
                if (files.some((f) => f.type.startsWith("image/"))) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
            />
            {isRunning && activeId ? (
              <button
                className="absolute bottom-2 right-2 rounded-md p-1.5 text-fg-muted hover:bg-hover hover:text-fg"
                title="中断"
                onClick={() => send({ type: "interrupt", sessionId: activeId })}
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                className="absolute bottom-2 right-2 rounded-md p-1.5 text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
                title="送信 (Enter)"
                disabled={!connected || (!text.trim() && attachments.length === 0)}
                onClick={submit}
              >
                <CornerDownLeft size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
