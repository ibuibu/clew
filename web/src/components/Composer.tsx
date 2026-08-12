import { useState } from "react";
import { useActiveSession, useChatStore } from "../store";
import { send } from "../ws";
import { cwdRef, permModeRef } from "./Header";

export function Composer() {
  const [text, setText] = useState("");
  const connected = useChatStore((s) => s.connected);
  const activeId = useChatStore((s) => s.activeId);
  const session = useActiveSession();
  const isRunning = session?.isRunning ?? false;

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || !connected) return;
    if (activeId) {
      send({ type: "user_message", sessionId: activeId, text: trimmed });
    } else {
      // ドラフト状態: 新規セッションを作成（cwd/permission modeはヘッダーの選択を使う）
      send({
        type: "user_message",
        text: trimmed,
        cwd: cwdRef.current || undefined,
        permissionMode: permModeRef.current,
      });
    }
    setText("");
  };

  return (
    <footer className="border-t border-zinc-700 bg-zinc-800">
      <div className="mx-auto flex w-full max-w-3xl gap-2 px-4 py-3">
        <textarea
          className="max-h-48 min-h-11 flex-1 resize-none rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2.5 text-sm"
          placeholder={
            activeId
              ? "Claude Codeへの指示を入力… (Cmd+Enterで送信)"
              : "新しいセッションを開始… (Cmd+Enterで送信)"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {isRunning && activeId ? (
          <button
            className="rounded-lg bg-zinc-600 px-4 text-sm hover:bg-zinc-500"
            onClick={() => send({ type: "interrupt", sessionId: activeId })}
          >
            中断
          </button>
        ) : (
          <button
            className="rounded-lg bg-orange-500 px-4 text-sm text-white hover:bg-orange-400 disabled:opacity-50"
            disabled={!connected}
            onClick={submit}
          >
            送信
          </button>
        )}
      </div>
    </footer>
  );
}
