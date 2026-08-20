import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentKind, ModelChoice } from "@clew/shared";
import { appServer } from "./agents/codex/client.js";
import type { ModelListResponse } from "./agents/codex/protocol.js";

const cache = new Map<AgentKind, ModelChoice[]>();

// メッセージを送らないダミー入力。supportedModels() を呼ぶためだけにqueryを立てる
async function* noInput(): AsyncGenerator<never> {
  await new Promise(() => {});
}

async function fetchClaudeModels(): Promise<ModelChoice[]> {
  const q = query({ prompt: noInput(), options: { cwd: process.cwd() } });
  try {
    const models = await q.supportedModels();
    return models.map((m) => ({
      value: m.value,
      displayName: m.displayName,
      description: m.description,
      resolvedModel: m.resolvedModel,
    }));
  } finally {
    await q.interrupt().catch(() => {});
  }
}

async function fetchCodexModels(): Promise<ModelChoice[]> {
  const res = await appServer.request<ModelListResponse>("model/list", {});
  const models = res.data.filter((m) => !m.hidden);
  const fallback = models.find((m) => m.isDefault);
  return [
    // 「デフォルト」の行に実際のモデル名を出すため、Claude側と同じ形の目印を混ぜる
    ...(fallback
      ? [{ value: "default", displayName: "default", resolvedModel: fallback.model }]
      : []),
    ...models.map((m) => ({
      value: m.id,
      displayName: m.displayName,
      description: m.description,
      resolvedModel: m.model,
    })),
  ];
}

// エージェント本体が提供するモデル一覧を取得する（プロセス内でキャッシュ）
export async function listModels(agent: AgentKind): Promise<ModelChoice[]> {
  const cached = cache.get(agent);
  if (cached) return cached;
  const models = agent === "codex" ? await fetchCodexModels() : await fetchClaudeModels();
  cache.set(agent, models);
  return models;
}
