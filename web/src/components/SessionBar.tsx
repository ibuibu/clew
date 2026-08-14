import { useEffect, useState } from "react";
import { useActiveSession, useChatStore } from "../store";
import { send } from "../ws";
import type { ModelChoice, PermissionMode } from "@clew/shared";

// 新規セッション作成時の設定（ドラフト状態でのみ編集できる）
export const cwdRef = { current: localStorage.getItem("clew-cwd") || "" };
export const permModeRef = {
  current: (localStorage.getItem("clew-perm") || "auto") as PermissionMode,
};
export const modelRef = { current: localStorage.getItem("clew-model") || "" };

type RepoEntry = { path: string; name: string; kind: "repo" | "worktree" };

const PERM_LABEL: Record<PermissionMode, string> = {
  default: "default",
  acceptEdits: "accept edits",
  plan: "plan",
  auto: "auto",
  dontAsk: "don't ask",
  bypassPermissions: "bypass permissions",
};

const pill = "rounded-full border border-line bg-elevated px-2 py-0.5 text-xs";
const staticPill = "rounded-full bg-hover px-2 py-0.5 text-xs text-fg-muted";

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

  const repoName = (p: string) => p.split("/").slice(-2).join("/");

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-fg-muted">
      {/* cwdはセッション作成時に固定されるため、作成後は表示のみ */}
      {activeId ? (
        <span className={staticPill} title={session?.meta.cwd}>
          📁 {repoName(session?.meta.cwd ?? "")}
        </span>
      ) : (
        <select
          className={pill}
          title="作業ディレクトリ"
          value={cwd}
          onChange={(e) => {
            cwdRef.current = e.target.value;
            setCwd(e.target.value);
            localStorage.setItem("clew-cwd", e.target.value);
          }}
        >
          {repoOptions.length === 0 && worktreeOptions.length === 0 && (
            <option value="">（リポジトリなし）</option>
          )}
          <optgroup label="リポジトリ">
            {repoOptions.map((r) => (
              <option key={r.path} value={r.path}>
                📁 {r.name}
              </option>
            ))}
          </optgroup>
          {worktreeOptions.length > 0 && (
            <optgroup label="worktree">
              {worktreeOptions.map((r) => (
                <option key={r.path} value={r.path}>
                  🌳 {r.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
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

      {session && session.meta.totalCost > 0 && (
        <span className={staticPill}>💰 ${session.meta.totalCost.toFixed(4)}</span>
      )}
    </div>
  );
}
