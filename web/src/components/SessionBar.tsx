import { ChevronDown, Coins, Folder, GitBranch, MessageSquareReply, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useActiveSession, useChatStore } from "../store";
import { send } from "../ws";
import { conversationMarkdown } from "../markdown";
import { CopyButton } from "./CopyButton";
import { RepoPicker, type RepoEntry } from "./RepoPicker";
import { TagEditor } from "./Tags";
import type { ModelChoice, PermissionMode } from "@clew/shared";

// 新規セッション作成時の設定（ドラフト状態でのみ編集できる）
export const cwdRef = { current: localStorage.getItem("clew-cwd") || "" };
export const permModeRef = {
  current: (localStorage.getItem("clew-perm") || "auto") as PermissionMode,
};
export const modelRef = { current: localStorage.getItem("clew-model") || "" };

const PERM_LABEL: Record<PermissionMode, string> = {
  default: "default",
  acceptEdits: "accept edits",
  plan: "plan",
  auto: "auto",
  dontAsk: "don't ask",
  bypassPermissions: "bypass permissions",
};

// selectはline-heightを無視してフォントメトリクスで高さを決めるため、高さを固定して他のピルと揃える
const pill = "h-6 rounded-full border border-line bg-elevated px-2 text-xs";
const staticPill =
  "inline-flex h-6 items-center gap-1 rounded-full bg-hover px-2 text-xs text-fg-muted";

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
    <div ref={rootRef} className="relative">
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

export function SessionBar() {
  const activeId = useChatStore((s) => s.activeId);
  const session = useActiveSession();
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [cwd, setCwd] = useState(cwdRef.current);
  const [permMode, setPermMode] = useState(permModeRef.current);
  const [draftModel, setDraftModel] = useState(modelRef.current);

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
    // モデル一覧はClaude Code本体（SDKのsupportedModels）から取得する
    fetch("/api/models")
      .then((r) => r.json())
      .then((list: ModelChoice[]) => setModels(list))
      .catch(() => {});
  }, []);

  // 一覧に無いcwd（過去に選んだworktreeが消えた等）も選択肢として残す
  const custom =
    cwd && !repos.some((r) => r.path === cwd)
      ? [{ path: cwd, name: cwd, kind: "repo" as const }]
      : [];
  const repoOptions = [...custom, ...repos.filter((r) => r.kind === "repo")];
  const worktreeOptions = repos.filter((r) => r.kind === "worktree");

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

  const permValue = activeId ? (session?.meta.permissionMode ?? "default") : permMode;

  const selectPermMode = (mode: PermissionMode) => {
    if (activeId) {
      send({ type: "set_permission_mode", sessionId: activeId, mode });
    } else {
      permModeRef.current = mode;
      setPermMode(mode);
      localStorage.setItem("clew-perm", mode);
    }
  };

  const repoName = (p: string) => p.split("/").at(-1) ?? "";

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-fg-muted">
      {/* cwdはセッション作成時に固定されるため、作成後は表示のみ */}
      {activeId ? (
        <span className={staticPill} title={session?.meta.cwd}>
          {/* EnterWorktreeでcwdが移ると種別も変わるので、その都度一覧から引き直す */}
          {repos.find((r) => r.path === session?.meta.cwd)?.kind === "worktree" ? (
            <GitBranch size={12} />
          ) : (
            <Folder size={12} />
          )}
          {repoName(session?.meta.cwd ?? "")}
        </span>
      ) : (
        <RepoPicker
          value={cwd}
          entries={[...repoOptions, ...worktreeOptions]}
          onChange={(path) => {
            cwdRef.current = path;
            setCwd(path);
            localStorage.setItem("clew-cwd", path);
          }}
        />
      )}

      <select
        className={pill}
        title={activeId ? "このセッションのpermission modeを切り替え" : "permission mode"}
        value={permValue}
        onChange={(e) => selectPermMode(e.target.value as PermissionMode)}
      >
        {(Object.keys(PERM_LABEL) as PermissionMode[]).map((mode) => (
          <option key={mode} value={mode}>
            {PERM_LABEL[mode]}
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
          className="flex h-6 items-center gap-1 rounded-full px-1.5 text-xs text-fg-subtle hover:bg-hover hover:text-fg-muted"
        />
      )}

      {session && session.meta.totalCost > 0 && (
        <span className={`${staticPill} ml-auto`}>
          <Coins size={12} />${Math.round(session.meta.totalCost)}
        </span>
      )}
    </div>
  );
}
