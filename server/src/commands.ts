import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SlashCommandInfo } from "@clew/shared";

// project skills（<repo>/.claude/skills）を含むため一覧はcwdごとに変わる
const cache = new Map<string, Promise<SlashCommandInfo[]>>();

// メッセージを送らないダミー入力。supportedCommands() を呼ぶためだけにqueryを立てる
async function* noInput(): AsyncGenerator<never> {
  await new Promise(() => {});
}

async function fetchCommands(cwd: string): Promise<SlashCommandInfo[]> {
  const q = query({ prompt: noInput(), options: { cwd } });
  try {
    const commands = await q.supportedCommands();
    return commands.map((c) => ({
      name: c.name,
      description: c.description,
      argumentHint: c.argumentHint || undefined,
      aliases: c.aliases?.length ? c.aliases : undefined,
    }));
  } finally {
    await q.interrupt().catch(() => {});
  }
}

// 指定cwdで使えるスラッシュコマンド（skill含む）を返す（cwdごとにキャッシュ）
export function listCommands(cwd: string): Promise<SlashCommandInfo[]> {
  const cached = cache.get(cwd);
  if (cached) return cached;
  const pending = fetchCommands(cwd).catch((err) => {
    cache.delete(cwd);
    throw err;
  });
  cache.set(cwd, pending);
  return pending;
}
