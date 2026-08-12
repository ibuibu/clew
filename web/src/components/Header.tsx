import { useEffect, useState } from "react";
import { useActiveSession, useChatStore } from "../store";
import type { PermissionMode } from "@claude-web/shared";

export const cwdRef = { current: localStorage.getItem("claude-web-cwd") || "" };
export const permModeRef = { current: "default" as PermissionMode };

type RepoEntry = { path: string; name: string };

export function Header() {
  const connected = useChatStore((s) => s.connected);
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

  const selectCwd = (path: string) => {
    cwdRef.current = path;
    setCwd(path);
    localStorage.setItem("claude-web-cwd", path);
  };

  // 保存済みcwdがghq一覧に無い場合も選択肢として出す
  const options =
    cwd && !repos.some((r) => r.path === cwd)
      ? [{ path: cwd, name: cwd }, ...repos]
      : repos;

  const statusText = !connected
    ? "未接続（リロードで再接続）"
    : session
      ? `${session.meta.model ?? "…"} | ${session.meta.cwd} | $${session.meta.totalCost.toFixed(4)}`
      : "接続済み";

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-zinc-700 bg-zinc-800 px-4 py-2.5">
      <span className="mr-2 font-bold text-orange-400">⌘ Claude Web</span>
      {/* 新規セッション作成時の設定（既存セッションには影響しない） */}
      <select
        className="max-w-80 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm disabled:opacity-40"
        title="新規セッションの作業ディレクトリ"
        value={cwd}
        disabled={activeId != null}
        onChange={(e) => selectCwd(e.target.value)}
      >
        {options.length === 0 && <option value="">（ghqリポジトリが見つからない）</option>}
        {options.map((r) => (
          <option key={r.path} value={r.path}>
            {r.name}
          </option>
        ))}
      </select>
      <select
        className="rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm disabled:opacity-40"
        title="新規セッションのpermission mode"
        defaultValue="default"
        disabled={activeId != null}
        onChange={(e) => (permModeRef.current = e.target.value as PermissionMode)}
      >
        <option value="default">default（都度確認）</option>
        <option value="acceptEdits">acceptEdits（編集は自動許可）</option>
        <option value="plan">plan（計画のみ）</option>
      </select>
      <span className="ml-auto truncate text-xs text-zinc-400">{statusText}</span>
    </header>
  );
}
