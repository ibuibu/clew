import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ModelChoice } from "@clew/shared";

let cache: ModelChoice[] | null = null;

// メッセージを送らないダミー入力。supportedModels() を呼ぶためだけにqueryを立てる
async function* noInput(): AsyncGenerator<never> {
  await new Promise(() => {});
}

// Claude Codeが提供するモデル一覧を取得する（プロセス内でキャッシュ）
export async function listModels(): Promise<ModelChoice[]> {
  if (cache) return cache;
  const q = query({ prompt: noInput(), options: { cwd: process.cwd() } });
  try {
    const models = await q.supportedModels();
    cache = models.map((m) => ({
      value: m.value,
      displayName: m.displayName,
      description: m.description,
      resolvedModel: m.resolvedModel,
    }));
    return cache;
  } finally {
    await q.interrupt().catch(() => {});
  }
}
