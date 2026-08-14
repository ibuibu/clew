import { useChatStore } from "../store";
import { send } from "../ws";
import { ThemeToggle } from "./ThemeToggle";

export function Sidebar() {
  const order = useChatStore((s) => s.order);
  const sessions = useChatStore((s) => s.sessions);
  const activeId = useChatStore((s) => s.activeId);
  const setActive = useChatStore((s) => s.setActive);
  const connected = useChatStore((s) => s.connected);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
      <div className="px-3 py-2.5 font-bold text-accent">🧶 Clew</div>
      <button
        className="m-2 rounded-lg border border-dashed border-line px-3 py-2 text-sm text-fg-muted hover:border-accent hover:text-accent"
        onClick={() => setActive(null)}
      >
        ＋ 新規セッション
      </button>
      <div className="flex-1 overflow-y-auto">
        {order.map((id) => {
          const session = sessions[id];
          if (!session) return null;
          const needsAction = session.permission || session.question;
          const repoName = session.meta.cwd.split("/").slice(-2).join("/");
          return (
            <div
              key={id}
              className={`group flex cursor-pointer items-center gap-2 border-l-2 px-3 py-2 ${
                id === activeId
                  ? "border-accent bg-hover"
                  : "border-transparent hover:bg-hover"
              }`}
              onClick={() => setActive(id)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">
                  {needsAction && <span className="mr-1">❗</span>}
                  {session.isRunning && <span className="mr-1 animate-pulse text-accent">●</span>}
                  {session.meta.title || "（無題）"}
                </div>
                <div className="truncate text-[11px] text-fg-subtle">
                  {repoName} · ${session.meta.totalCost.toFixed(3)}
                </div>
              </div>
              <button
                className="hidden shrink-0 rounded px-1 text-fg-subtle hover:bg-hover hover:text-danger group-hover:block"
                title="セッションを削除"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`「${session.meta.title || "無題"}」を削除する？`)) {
                    send({ type: "close_session", sessionId: id });
                  }
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
        {activeId === null && (
          <div className="flex items-center gap-2 border-l-2 border-accent bg-hover px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">新規セッション</div>
              <div className="truncate text-[11px] text-fg-subtle">未送信</div>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
          {connected ? "接続済み" : "未接続（リロードで再接続）"}
        </span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
