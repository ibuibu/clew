import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentUsage, UsageWindow } from "@clew/shared";
import { appServer } from "./agents/codex/client.js";
import { createInputQueue } from "./input-queue.js";
import type { RateLimitsResponse, RateLimitWindow } from "./agents/codex/protocol.js";

const CACHE_MS = 60_000;
const POLL_MS = 30 * 60_000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const toMs = (iso: string | null | undefined) => {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(ms) ? null : ms;
};

// 分単位のウィンドウ幅に名前を付ける。想定外の幅はそのまま時間で出す
function windowLabel(mins: number | null): string {
  if (mins === null) return "利用量";
  if (mins >= 10080) return "週";
  if (mins >= 1440) return `${Math.round(mins / 1440)}日`;
  return `${Math.round(mins / 60)}時間`;
}

async function readClaude(): Promise<AgentUsage> {
  // usage取得のためだけにqueryを立てる。メッセージは送らない
  const input = createInputQueue();
  const q = query({ prompt: input.iterate(), options: { cwd: process.cwd() } });
  try {
    // 実験的APIなので、名前が変わったり消えたりしたらerrorに落とす
    const usage = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET();
    const limits = usage.rate_limits;
    if (!usage.rate_limits_available || !limits) {
      return {
        agent: "claude",
        plan: usage.subscription_type,
        windows: [],
        error: "プランの利用量が取れない接続方法です",
      };
    }
    const windows: UsageWindow[] = [];
    const push = (label: string, w?: { utilization: number | null; resets_at: string | null } | null) => {
      if (w && w.utilization !== null) {
        windows.push({ label, usedPercent: w.utilization, resetsAt: toMs(w.resets_at) });
      }
    };
    push("5時間", limits.five_hour);
    push("週", limits.seven_day);
    for (const m of limits.model_scoped ?? []) {
      push(`週 (${m.display_name})`, m);
    }
    return { agent: "claude", plan: usage.subscription_type, windows, error: null };
  } catch (err) {
    console.warn("claude usage failed:", err);
    return { agent: "claude", plan: null, windows: [], error: message(err) };
  } finally {
    // interrupt()ではCLIのプロセスが残るため、入力を閉じて終了させる
    input.close();
  }
}

async function readCodex(): Promise<AgentUsage> {
  try {
    const res = await appServer.request<RateLimitsResponse>("account/rateLimits/read", null);
    const { primary, secondary, planType } = res.rateLimits;
    const windows = [primary, secondary]
      .filter((w): w is RateLimitWindow => w !== null)
      .map((w) => ({
        label: windowLabel(w.windowDurationMins),
        usedPercent: w.usedPercent,
        resetsAt: w.resetsAt === null ? null : w.resetsAt * 1000,
      }));
    return { agent: "codex", plan: planType, windows, error: null };
  } catch (err) {
    console.warn("codex usage failed:", err);
    return { agent: "codex", plan: null, windows: [], error: message(err) };
  }
}

let cached: { at: number; usage: AgentUsage[] } | null = null;

// 両エージェントのレート制限の消費量をまとめて返す。取得に数秒かかるので短時間キャッシュする
export async function readUsage(): Promise<AgentUsage[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.usage;
  const usage = await Promise.all([readClaude(), readCodex()]);
  cached = { at: Date.now(), usage };
  return usage;
}

// UIを開いていなくても使いすぎに気づけるよう、定期的に取り直してクライアントへ配る
export function startUsagePolling(onUsage: (usage: AgentUsage[]) => void) {
  const tick = async () => {
    // 前回の値をそのまま配っても意味がないのでキャッシュを捨てる
    cached = null;
    onUsage(await readUsage());
  };
  void tick();
  setInterval(() => void tick(), POLL_MS).unref();
}
