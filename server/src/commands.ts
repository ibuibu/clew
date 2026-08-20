import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentKind, SlashCommandInfo } from "@clew/shared";
import { appServer } from "./agents/codex/client.js";
import type { SkillsListResponse } from "./agents/codex/protocol.js";

// project skills（<repo>/.claude/skills）を含むため一覧はcwdごとに変わる
const cache = new Map<string, Promise<SlashCommandInfo[]>>();

// メッセージを送らないダミー入力。supportedCommands() を呼ぶためだけにqueryを立てる
async function* noInput(): AsyncGenerator<never> {
  await new Promise(() => {});
}

async function fetchClaudeCommands(cwd: string): Promise<SlashCommandInfo[]> {
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

// Codexのスラッシュコマンドは組み込みのため、補完できるのはskillだけ
async function fetchCodexCommands(cwd: string): Promise<SlashCommandInfo[]> {
  const res = await appServer.request<SkillsListResponse>("skills/list", { cwds: [cwd] });
  return res.data
    .flatMap((entry) => entry.skills)
    .filter((skill) => skill.enabled)
    .map((skill) => ({ name: skill.name, description: skill.description }));
}

// 指定cwdで使えるスラッシュコマンド（skill含む）を返す（エージェント・cwdごとにキャッシュ）
export function listCommands(agent: AgentKind, cwd: string): Promise<SlashCommandInfo[]> {
  const key = `${agent}:${cwd}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = (agent === "codex" ? fetchCodexCommands(cwd) : fetchClaudeCommands(cwd)).catch(
    (err) => {
      cache.delete(key);
      throw err;
    },
  );
  cache.set(key, pending);
  return pending;
}
