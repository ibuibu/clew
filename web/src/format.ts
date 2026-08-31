import type { AgentKind } from "@clew/shared";

export const AGENT_LABEL: Record<AgentKind, string> = { claude: "Claude", codex: "Codex" };

// 40.1k は残し 1.0M は 1M にする
const trimZero = (n: number) => n.toFixed(1).replace(/\.0$/, "");

export const formatTokens = (n: number) => {
  if (n >= 1_000_000) return `${trimZero(n / 1_000_000)}M`;
  if (n >= 1000) return `${trimZero(n / 1000)}k`;
  return String(n);
};

// ウィンドウが空くまでの目安。粒度は荒くていいので一番大きい単位だけ出す
export function untilReset(resetsAt: number | null): string {
  if (resetsAt === null) return "";
  const mins = Math.round((resetsAt - Date.now()) / 60_000);
  if (mins <= 0) return "まもなく回復";
  if (mins < 60) return `あと${mins}分`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `あと${hours}時間` : `あと${Math.round(hours / 24)}日`;
}
