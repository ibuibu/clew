import { Bot, ChevronDown, Coins, Folder, Gauge, MessageSquareReply, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useActiveSession, useChatStore } from "../store";
import { send } from "../ws";
import { cwdLabel } from "../cwd";
import { conversationMarkdown } from "../markdown";
import { CopyButton } from "./CopyButton";
import { RepoPicker, type RepoEntry } from "./RepoPicker";
import { TagEditor } from "./Tags";
import type {
  AgentKind,
  AgentUsage,
  CodexMode,
  ModelChoice,
  PermissionMode,
  SessionMode,
} from "@clew/shared";

// 新規セッション作成時の設定（ドラフト状態でのみ編集できる）
export const cwdRef = { current: localStorage.getItem("clew-cwd") || "" };
export const agentRef = { current: (localStorage.getItem("clew-agent") || "claude") as AgentKind };
export const permModeRef = {
  current: (localStorage.getItem("clew-perm") || "auto") as SessionMode,
};
export const modelRef = { current: localStorage.getItem("clew-model") || "" };

const AGENT_LABEL: Record<AgentKind, string> = { claude: "Claude", codex: "Codex" };

const CLAUDE_PERM_LABEL: Record<PermissionMode, string> = {
  default: "default",
  acceptEdits: "accept edits",
  plan: "plan",
  auto: "auto",
  dontAsk: "don't ask",
  bypassPermissions: "bypass permissions",
};

// Codexの承認は approvalPolicy と sandbox の組で決まるので、その組に名前を付けて並べる
const CODEX_PERM_LABEL: Record<CodexMode, string> = {
  plan: "plan",
  readOnly: "read only",
  untrusted: "untrusted",
  onRequest: "on request",
  auto: "auto",
  never: "never ask",
  fullAccess: "full access",
};

const PERM_LABELS: Record<AgentKind, Record<string, string>> = {
  claude: CLAUDE_PERM_LABEL,
  codex: CODEX_PERM_LABEL,
};

const DEFAULT_MODE: Record<AgentKind, SessionMode> = { claude: "default", codex: "onRequest" };

const formatTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

// selectはline-heightを無視してフォントメトリクスで高さを決めるため、高さを固定して他のピルと揃える
const pill = "h-6 shrink-0 rounded-full border border-line bg-elevated px-2 text-xs";
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

// ウィンドウが空くまでの目安。粒度は荒くていいので一番大きい単位だけ出す
function untilReset(resetsAt: number | null): string {
  if (resetsAt === null) return "";
  const mins = Math.round((resetsAt - Date.now()) / 60_000);
  if (mins <= 0) return "まもなく回復";
  if (mins < 60) return `あと${mins}分`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `あと${hours}時間` : `あと${Math.round(hours / 24)}日`;
}

const barColor = (percent: number) =>
  percent >= 80 ? "bg-danger" : percent >= 50 ? "bg-accent" : "bg-ok";

// ClaudeとCodexのレート制限の消費量をまとめて見る
function UsagePopover() {
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<AgentUsage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
        if (!cancelled) setUsage(list);
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
        className="flex h-6 items-center gap-0.5 rounded-full px-1.5 text-fg-subtle hover:bg-hover hover:text-fg-muted"
        title="利用量を見る"
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
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [cwd, setCwd] = useState(cwdRef.current);
  const [draftAgent, setDraftAgent] = useState(agentRef.current);
  const [permMode, setPermMode] = useState(permModeRef.current);
  const [draftModel, setDraftModel] = useState(modelRef.current);

  const agent = session?.meta.agent ?? draftAgent;

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

  // モデル一覧はエージェント本体から取得する（Claudeは supportedModels、Codexは model/list）
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/models?agent=${agent}`)
      .then((r) => r.json())
      .then((list: ModelChoice[]) => {
        if (!cancelled) setModels(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agent]);

  // 一覧に無いcwd（過去に選んだリポジトリが消えた等）も選択肢として残す
  const custom = cwd && !repos.some((r) => r.path === cwd) ? [{ path: cwd, name: cwd }] : [];
  const repoOptions = [...custom, ...repos];

  // 空文字 = モデル未指定（Claude Codeの設定に従う）。SDKの "default" 行と重複するので除外する
  const modelValue = activeId ? (session?.meta.modelPref ?? "") : draftModel;
  const defaultRow = models.find((m) => m.value === "default");
  const defaultAlias = defaultRow?.resolvedModel
    ? models.find((m) => m.value !== "default" && m.resolvedModel === defaultRow.resolvedModel)
    : undefined;
  const defaultName = defaultAlias?.displayName ?? defaultRow?.resolvedModel;
  const modelOptions: ModelChoice[] = [
    { value: "", displayName: defaultName ? `デフォルト（${defaultName}）` : "デフォルト" },
    ...models.filter((m) => m.value !== "default"),
  ];
  if (modelValue && !modelOptions.some((m) => m.value === modelValue)) {
    modelOptions.push({ value: modelValue, displayName: modelValue });
  }

  const selectModel = (value: string) => {
    if (activeId) {
      // 実行中セッションのモデルは途中で切り替えられる
      send({ type: "set_model", sessionId: activeId, model: value || undefined });
    } else {
      modelRef.current = value;
      setDraftModel(value);
      localStorage.setItem("clew-model", value);
    }
  };

  const permLabels = PERM_LABELS[agent];
  // エージェントを切り替えた直後は、前のエージェントのモードが残っていることがある
  const permValue = activeId
    ? (session?.meta.permissionMode ?? DEFAULT_MODE[agent])
    : permMode in permLabels
      ? permMode
      : DEFAULT_MODE[agent];

  const selectPermMode = (mode: SessionMode) => {
    if (activeId) {
      send({ type: "set_permission_mode", sessionId: activeId, mode });
    } else {
      permModeRef.current = mode;
      setPermMode(mode);
      localStorage.setItem("clew-perm", mode);
    }
  };

  const selectAgent = (next: AgentKind) => {
    agentRef.current = next;
    setDraftAgent(next);
    localStorage.setItem("clew-agent", next);
    // モードとモデルの選択肢がエージェントごとに違うので既定に戻す
    selectPermMode(DEFAULT_MODE[next]);
    selectModel("");
  };


  // 折り返すと2段になって入力欄が押し下げられるので、はみ出させて1行に保つ
  return (
    <div className="mb-2 flex items-center gap-1.5 text-fg-muted">
      {/* cwdはセッション作成時に固定されるため、作成後は表示のみ */}
      {activeId ? (
        <span className={`${staticPill} min-w-0 !shrink`} title={session?.meta.cwd}>
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

      {/* エージェントはセッション作成時に固定されるため、作成後は表示のみ */}
      {activeId ? (
        <span className={staticPill}>
          <Bot size={12} />
          {AGENT_LABEL[agent]}
        </span>
      ) : (
        <select
          className={pill}
          title="エージェント"
          value={draftAgent}
          onChange={(e) => selectAgent(e.target.value as AgentKind)}
        >
          {(Object.keys(AGENT_LABEL) as AgentKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {AGENT_LABEL[kind]}
            </option>
          ))}
        </select>
      )}

      <select
        className={pill}
        title={activeId ? "このセッションのpermission modeを切り替え" : "permission mode"}
        value={permValue}
        onChange={(e) => selectPermMode(e.target.value as SessionMode)}
      >
        {Object.keys(permLabels).map((mode) => (
          <option key={mode} value={mode}>
            {permLabels[mode]}
          </option>
        ))}
      </select>

      <select
        className={pill}
        title={activeId ? "このセッションのモデルを切り替え" : "モデル"}
        value={modelValue}
        onChange={(e) => selectModel(e.target.value)}
      >
        {modelOptions.map((m) => (
          <option key={m.value} value={m.value} title={m.description}>
            {m.displayName}
          </option>
        ))}
      </select>

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

      {session && session.meta.totalCost > 0 && (
        <span className={`${staticPill} ml-auto`}>
          <Coins size={12} />${Math.round(session.meta.totalCost)}
        </span>
      )}

      {/* Codexは金額を返さないのでトークン数を出す */}
      {session?.meta.tokens && (
        <span className={`${staticPill} ml-auto`} title="入力 / 出力トークン">
          <Coins size={12} />
          {formatTokens(session.meta.tokens.input)} / {formatTokens(session.meta.tokens.output)}
        </span>
      )}

      <UsagePopover />
    </div>
  );
}
