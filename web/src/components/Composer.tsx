import { useState } from "react";
import { useActiveSession, useChatStore } from "../store";
import { send } from "../ws";
import { SessionBar, cwdRef, modelRef, permModeRef } from "./SessionBar";

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
  };

  return (
    <footer className="border-t border-line bg-panel">
      <div className="mx-auto w-full max-w-3xl px-4 py-3">
        <SessionBar />
        <div className="flex gap-2">
          <textarea
            className="max-h-48 min-h-11 flex-1 resize-none rounded-lg border border-line bg-elevated px-3 py-2.5 text-sm"
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
