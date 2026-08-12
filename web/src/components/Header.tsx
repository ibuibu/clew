import { useChatStore } from "../store";
import type { PermissionMode } from "@claude-web/shared";

export const cwdRef = { current: localStorage.getItem("claude-web-cwd") || "" };
export const permModeRef = { current: "default" as PermissionMode };

export function Header() {
  const connected = useChatStore((s) => s.connected);
  const session = useChatStore((s) => s.session);
  const totalCost = useChatStore((s) => s.totalCost);

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-zinc-700 bg-zinc-800 px-4 py-2.5">
      <span className="mr-2 font-bold text-orange-400">⌘ Claude Web</span>
      <input
        className="w-80 rounded-md border border-zinc-600 bg-zinc-900 px-2.5 py-1.5 text-sm"
        placeholder="作業ディレクトリ (例: /Users/you/project)"
        defaultValue={cwdRef.current}
        onChange={(e) => {
          cwdRef.current = e.target.value.trim();
          localStorage.setItem("claude-web-cwd", cwdRef.current);
        }}
      />
      <select
        className="rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm"
        defaultValue="default"
        onChange={(e) => (permModeRef.current = e.target.value as PermissionMode)}
      >
        <option value="default">default（都度確認）</option>
        <option value="acceptEdits">acceptEdits（編集は自動許可）</option>
        <option value="plan">plan（計画のみ）</option>
      </select>
      <button
        className="rounded-md bg-orange-500 px-3.5 py-1.5 text-sm text-white hover:bg-orange-400"
        onClick={() => location.reload()}
      >
        新規セッション
      </button>
      <span className="ml-auto text-xs text-zinc-400">
        {!connected
          ? "未接続（リロードで再接続）"
          : session
            ? `${session.model} | ${session.cwd} | $${totalCost.toFixed(4)}`
            : "接続済み"}
      </span>
    </header>
  );
}
