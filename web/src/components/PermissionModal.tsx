import { useChatStore } from "../store";
import { send } from "../ws";

export function PermissionModal() {
  const permission = useChatStore((s) => s.permission);
  if (!permission) return null;

  const respond = (behavior: "allow" | "deny") => {
    send({ type: "permission_response", id: permission.id, behavior });
    useChatStore.getState().clearPermission();
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60">
      <div className="max-h-[80vh] w-[min(560px,90vw)] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-800 p-5">
        <h3 className="mb-2.5 text-[15px] font-bold">
          🔒 ツール実行の許可: <span className="text-orange-400">{permission.toolName}</span>
        </h3>
        <pre className="max-h-72 overflow-auto rounded-lg bg-zinc-900 p-2.5 text-xs">
          {JSON.stringify(permission.input, null, 2)}
        </pre>
        <div className="mt-3.5 flex justify-end gap-2.5">
          <button
            className="rounded-lg bg-red-400 px-5 py-2 text-sm font-bold text-zinc-900 hover:bg-red-300"
            onClick={() => respond("deny")}
          >
            拒否
          </button>
          <button
            className="rounded-lg bg-green-400 px-5 py-2 text-sm font-bold text-zinc-900 hover:bg-green-300"
            onClick={() => respond("allow")}
          >
            許可
          </button>
        </div>
      </div>
    </div>
  );
}
