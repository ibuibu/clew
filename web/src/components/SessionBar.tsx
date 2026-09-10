import { ChevronDown, Coins, Folder, Gauge, MessageSquareReply, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useActiveSession, useChatStore } from "../store";
import { send } from "../ws";
import { cwdLabel } from "../cwd";
import { agentRef, cwdRef, effortRef, modelRef, permModeRef } from "../draft";
import { AGENT_LABEL, formatTokens, untilReset } from "../format";
import { ALERT_PERCENT, usageAlerts } from "../usage-alert";
import { conversationMarkdown } from "../markdown";
import { CopyButton } from "./CopyButton";
import { RepoPicker, type RepoEntry } from "./RepoPicker";
import { SessionSettings } from "./SessionSettings";
import { TagEditor } from "./Tags";
import type { AgentUsage } from "@clew/shared";

const staticPill =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-hover px-2 text-xs text-fg-muted";

// 止まっているように見えるときの催促などを、開いて選ぶだけで送る
function QuickReplies({ sessionId }: { sessionId: string | null }) {
  const items = useChatStore((s) => s.quickReplies);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  // 1回目のクリックで赤くし、2回目で消す
  const [deleting, setDeleting] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        className="flex h-6 items-center gap-0.5 rounded-full px-1.5 text-fg-subtle hover:bg-hover hover:text-fg-muted"
        title="定型文を送る"
        onClick={() => setOpen((v) => !v)}
      >
        <MessageSquareReply size={13} />
        <ChevronDown size={11} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-44 rounded-lg border border-line bg-elevated p-2 shadow-lg">
          {/* タグと同じく、入力欄が上・一覧が下 */}
          <input
            className="w-full bg-transparent px-1 py-0.5 text-xs outline-none"
            title="定型文を追加"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" && draft.trim()) {
                send({ type: "add_quick_reply", text: draft.trim() });
                setDraft("");
              }
              if (e.key === "Escape") setOpen(false);
            }}
          />
          {items.length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto border-t border-line pt-1">
              {items.map((text) => (
                <div
                  key={text}
                  className="group/reply flex items-center rounded hover:bg-hover"
                  onMouseLeave={() => setDeleting(null)}
                >
                  <button
                    className="min-w-0 flex-1 truncate px-1.5 py-1 text-left text-xs text-fg-muted hover:text-fg"
                    onClick={() => {
                      // ドラフト状態なら、入力欄から送るのと同じ条件で新規セッションを作る
                      send(
                        sessionId
                          ? { type: "user_message", sessionId, text, images: [] }
                          : {
                              type: "user_message",
                              text,
                              images: [],
                              cwd: cwdRef.current || undefined,
                              agent: agentRef.current,
                              permissionMode: permModeRef.current,
                              model: modelRef.current || undefined,
                              effort: effortRef.current || undefined,
                            },
                      );
                      setOpen(false);
                    }}
                  >
                    {text}
                  </button>
                  {deleting === text ? (
                    <button
                      className="mr-1 shrink-0 rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold text-app hover:opacity-90"
                      onClick={() => {
                        send({ type: "delete_quick_reply", text });
                        setDeleting(null);
                      }}
                    >
                      削除
                    </button>
                  ) : (
                    <button
                      className="mr-1 hidden shrink-0 rounded p-0.5 text-fg-subtle hover:text-danger group-hover/reply:block"
                      title="この定型文を消す"
                      onClick={() => setDeleting(text)}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const barColor = (percent: number) =>
  percent >= 80 ? "bg-danger" : percent >= 50 ? "bg-accent" : "bg-ok";

// ClaudeとCodexのレート制限の消費量をまとめて見る
function UsagePopover() {
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState<AgentUsage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // サーバーが定期取得した値。開いた直後の空表示を防ぐ
  const polled = useChatStore((s) => s.usage);
  const usage = fetched ?? polled;
  const alerted = usageAlerts(usage).length > 0;

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  // 開くたびに取り直す。エージェント本体への問い合わせに数秒かかるためサーバー側でキャッシュされる
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFailed(false);
    fetch("/api/usage")
      .then((r) => r.json())
      .then((list: AgentUsage[]) => {
        if (!cancelled) setFetched(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative ml-auto">
      <button
        className={`flex h-6 items-center gap-0.5 rounded-full px-1.5 hover:bg-hover ${
          alerted ? "text-danger" : "text-fg-subtle hover:text-fg-muted"
        }`}
        title={alerted ? `利用量が${ALERT_PERCENT}%を超えています` : "利用量を見る"}
        onClick={() => setOpen((v) => !v)}
      >
        <Gauge size={13} />
        <ChevronDown size={11} />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-1 w-64 rounded-lg border border-line bg-elevated p-2.5 shadow-lg">
          {failed ? (
            <div className="text-xs text-fg-subtle">取得できませんでした</div>
          ) : !usage ? (
            <div className="text-xs text-fg-subtle">読み込み中…</div>
          ) : (
            usage.map((u) => (
              <div key={u.agent} className="mb-3 last:mb-0">
                <div className="mb-1 flex items-baseline gap-1.5">
                  <span className="text-xs font-bold">{AGENT_LABEL[u.agent]}</span>
                  {u.plan && <span className="text-[10px] text-fg-subtle">{u.plan}</span>}
                </div>
                {u.windows.length === 0 ? (
                  <div className="break-words text-[11px] text-fg-subtle">
                    {u.error ?? "情報なし"}
                  </div>
                ) : (
                  u.windows.map((w) => (
                    <div key={w.label} className="mb-1.5 last:mb-0">
                      <div className="flex items-baseline justify-between text-[11px]">
                        <span className="text-fg-muted">{w.label}</span>
                        <span className="tabular-nums text-fg-muted">
                          {w.usedPercent}%
                          <span className="ml-1.5 text-fg-subtle">{untilReset(w.resetsAt)}</span>
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-hover">
                        <div
                          className={`h-full rounded-full ${barColor(w.usedPercent)}`}
                          style={{ width: `${Math.min(100, w.usedPercent)}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function SessionBar() {
  const activeId = useChatStore((s) => s.activeId);
  const session = useActiveSession();
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [cwd, setCwd] = useState(cwdRef.current);

  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((list: RepoEntry[]) => {
        setRepos(list);
        // 保存済みのcwdがなければ一覧の先頭をデフォルトに
        if (!cwdRef.current && list.length > 0) {
          cwdRef.current = list[0].path;
          setCwd(list[0].path);
        }
      })
      .catch(() => {});
  }, []);

  // 一覧に無いcwd（過去に選んだリポジトリが消えた等）も選択肢として残す
  const custom = cwd && !repos.some((r) => r.path === cwd) ? [{ path: cwd, name: cwd }] : [];
  const repoOptions = [...custom, ...repos];

  // 折り返すと2段になって入力欄が押し下げられるので、はみ出させて1行に保つ。
  // overflowを付けるとピルのポップオーバーが切られるのでスクロールにはできない
  return (
    <div className="mb-2 flex items-center gap-1.5 text-fg-muted">
      {/* cwdはセッション作成時に固定されるため、作成後は表示のみ */}
      {activeId ? (
        <span className={`${staticPill} min-w-24 max-w-40 !shrink`} title={session?.meta.cwd}>
          <Folder size={12} />
          <span className="truncate">{cwdLabel(session?.meta.cwd ?? "")}</span>
        </span>
      ) : (
        <RepoPicker
          value={cwd}
          entries={repoOptions}
          onChange={(path) => {
            cwdRef.current = path;
            setCwd(path);
            localStorage.setItem("clew-cwd", path);
          }}
        />
      )}

      <SessionSettings />

      {/* タグはセッション作成後にしか付けられないので、ドラフト状態では出さない */}
      {activeId && <TagEditor sessionId={activeId} tags={session?.meta.tags ?? []} />}

      <QuickReplies sessionId={activeId} />

      {/* ツール実行を除いた会話本文だけをmarkdownで持ち出す */}
      {session && session.items.length > 0 && (
        <CopyButton
          text={conversationMarkdown(session.items)}
          label="全文コピー"
          className="flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 text-xs text-fg-subtle hover:bg-hover hover:text-fg-muted"
        />
      )}

      {session?.meta.context && (
        <span className={`${staticPill} ml-auto`} title="コンテキスト使用量（直近ターン）">
          {formatTokens(session.meta.context.used)}/{formatTokens(session.meta.context.window)} (
          {Math.round((session.meta.context.used / session.meta.context.window) * 100)}%)
        </span>
      )}

      {/* Codexはコンテキスト使用量を返さないので、代わりにトークン数を出す */}
      {session?.meta.agent === "codex" && session.meta.tokens && (
        <span className={`${staticPill} ml-auto`} title="入力 / 出力トークン">
          <Coins size={12} />
          {formatTokens(session.meta.tokens.input)} / {formatTokens(session.meta.tokens.output)}
        </span>
      )}

      <UsagePopover />
    </div>
  );
}
