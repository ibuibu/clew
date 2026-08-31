import { TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { AGENT_LABEL, untilReset } from "../format";
import { useChatStore } from "../store";
import { ALERT_PERCENT, alertKey, usageAlerts } from "../usage-alert";

export function UsageAlertBar() {
  const usage = useChatStore((s) => s.usage);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const alerts = usageAlerts(usage).filter((a) => !dismissed.includes(alertKey(a)));
  if (alerts.length === 0) return null;

  return (
    <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-danger bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
      <TriangleAlert size={13} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        利用量が{ALERT_PERCENT}%超:{" "}
        {alerts
          .map((a) => {
            const reset = untilReset(a.window.resetsAt);
            return `${AGENT_LABEL[a.agent]} ${a.window.label} ${a.window.usedPercent}%${
              reset ? `（${reset}）` : ""
            }`;
          })
          .join(" / ")}
      </span>
      <button
        className="shrink-0 rounded p-0.5 hover:bg-danger/20"
        title="閉じる"
        onClick={() => setDismissed((prev) => [...prev, ...alerts.map(alertKey)])}
      >
        <X size={13} />
      </button>
    </div>
  );
}
