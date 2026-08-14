import { useActiveSession, useChatStore } from "../store";
import { send } from "../ws";

export function PermissionPrompt() {
  const activeId = useChatStore((s) => s.activeId);
  const session = useActiveSession();
  const permission = session?.permission;
  if (!permission || !activeId) return null;

  const respond = (behavior: "allow" | "deny") => {
    send({ type: "permission_response", sessionId: activeId, id: permission.id, behavior });
  };

  return (
    <div className="w-[95%] self-start rounded-xl border border-accent bg-elevated p-4">
      <h3 className="mb-2.5 text-[15px] font-bold">
        🔒 ツール実行の許可: <span className="text-accent">{permission.toolName}</span>
      </h3>
      <pre className="max-h-72 overflow-auto rounded-lg bg-panel p-2.5 text-xs">
        {JSON.stringify(permission.input, null, 2)}
      </pre>
      <div className="mt-3.5 flex justify-end gap-2.5">
        <button
          className="rounded-lg bg-danger px-5 py-2 text-sm font-bold text-app hover:opacity-90"
          onClick={() => respond("deny")}
        >
          拒否
        </button>
        <button
          className="rounded-lg bg-ok px-5 py-2 text-sm font-bold text-app hover:opacity-90"
          onClick={() => respond("allow")}
        >
          許可
        </button>
      </div>
    </div>
  );
}
