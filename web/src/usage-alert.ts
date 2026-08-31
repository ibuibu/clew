import type { AgentKind, AgentUsage, UsageWindow } from "@clew/shared";

export const ALERT_PERCENT = 85;

export type UsageAlert = { agent: AgentKind; window: UsageWindow };

// resetsAtを含めるので、枠が空いて再び超えたときは別の通知として扱われる
export const alertKey = (a: UsageAlert) => `${a.agent}\n${a.window.label}\n${a.window.resetsAt}`;

export function usageAlerts(usage: AgentUsage[] | null): UsageAlert[] {
  return (usage ?? []).flatMap((u) =>
    u.windows
      .filter((w) => w.usedPercent >= ALERT_PERCENT)
      .map((w) => ({ agent: u.agent, window: w })),
  );
}
