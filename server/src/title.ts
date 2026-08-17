import { query } from "@anthropic-ai/claude-agent-sdk";

const MAX_INPUT = 1500;
const MAX_TITLE = 40;

// 会話の先頭だけを見て短いタイトルを付ける。安いモデルで1往復だけ回す
export async function generateTitle(userText: string, replyText: string): Promise<string | null> {
  const prompt = [
    "次の会話に短いタイトルを付けてください。",
    "条件: 20文字以内、体言止め、記号や引用符で囲まない、タイトルだけを出力する。",
    "",
    `# ユーザー\n${userText.slice(0, MAX_INPUT)}`,
    `# アシスタント\n${replyText.slice(0, MAX_INPUT)}`,
  ].join("\n");

  try {
    const q = query({
      prompt,
      options: {
        model: "haiku",
        maxTurns: 1,
        allowedTools: [],
        // CLAUDE.md やプロジェクト設定はタイトル生成には不要
        settingSources: [],
      },
    });
    for await (const message of q) {
      if (message.type === "result" && message.subtype === "success") {
        return clean(message.result);
      }
    }
  } catch (err) {
    console.warn("generateTitle failed:", err);
  }
  return null;
}

function clean(raw: string): string | null {
  const title = raw
    .replace(/\s+/g, " ")
    .replace(/^["'「『]|["'」』]$/g, "")
    .trim()
    .slice(0, MAX_TITLE);
  return title || null;
}
