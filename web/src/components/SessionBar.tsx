import { useEffect, useState } from "react";
import { useActiveSession, useChatStore } from "../store";
import { send } from "../ws";
import type { ModelChoice, PermissionMode } from "@claude-web/shared";

// 新規セッション作成時の設定（ドラフト状態でのみ編集できる）
export const cwdRef = { current: localStorage.getItem("claude-web-cwd") || "" };
export const permModeRef = {
  current: (localStorage.getItem("claude-web-perm") || "default") as PermissionMode,
};
export const modelRef = { current: localStorage.getItem("claude-web-model") || "" };

type RepoEntry = { path: string; name: string };

const PERM_LABEL: Record<PermissionMode, string> = {
  default: "都度確認",
  acceptEdits: "編集は自動許可",
  plan: "計画のみ",
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

  const repoOptions =
    cwd && !repos.some((r) => r.path === cwd) ? [{ path: cwd, name: cwd }, ...repos] : repos;

  // 空文字 = モデル未指定（Claude Codeの設定に従う）。SDKの "default" 行と重複するので除外する
  const modelValue = activeId ? (session?.meta.modelPref ?? "") : draftModel;
  const modelOptions: ModelChoice[] = [
    { value: "", displayName: "デフォルト" },
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
      localStorage.setItem("claude-web-model", value);
    }
  };

  const repoName = (p: string) => p.split("/").slice(-2).join("/");

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-fg-muted">
      {/* cwdとpermission modeはセッション作成時に固定されるため、作成後は表示のみ */}
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
            localStorage.setItem("claude-web-cwd", e.target.value);
          }}
        >
          {repoOptions.length === 0 && <option value="">（リポジトリなし）</option>}
          {repoOptions.map((r) => (
            <option key={r.path} value={r.path}>
              📁 {r.name}
            </option>
          ))}
        </select>
      )}

      {activeId ? (
        <span className={staticPill}>🔒 {PERM_LABEL[session?.meta.permissionMode ?? "default"]}</span>
      ) : (
        <select
          className={pill}
          title="permission mode"
          value={permMode}
          onChange={(e) => {
            const mode = e.target.value as PermissionMode;
            permModeRef.current = mode;
            setPermMode(mode);
            localStorage.setItem("claude-web-perm", mode);
          }}
        >
          {(Object.keys(PERM_LABEL) as PermissionMode[]).map((mode) => (
            <option key={mode} value={mode}>
              🔒 {PERM_LABEL[mode]}
            </option>
          ))}
        </select>
      )}

      <select
        className={pill}
        title={activeId ? "このセッションのモデルを切り替え" : "モデル"}
        value={modelValue}
        onChange={(e) => selectModel(e.target.value)}
      >
        {modelOptions.map((m) => (
          <option key={m.value} value={m.value} title={m.description}>
            🧠 {m.displayName}
          </option>
        ))}
      </select>

      {session && session.meta.totalCost > 0 && (
        <span className={staticPill}>💰 ${session.meta.totalCost.toFixed(4)}</span>
      )}
    </div>
  );
}
