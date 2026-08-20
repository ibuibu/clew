import type { ChatItem } from "./store";

// ツール実行・思考・メタ情報は落とし、会話の本文だけをmarkdownにする
export function itemMarkdown(item: ChatItem): string | null {
  if (item.kind === "user") {
    const images = (item.images ?? []).map((url) => `![添付画像](${location.origin}${url})`);
    return [...images, item.text].filter(Boolean).join("\n\n") || null;
  }
  if (item.kind === "text") return item.text.trim() || null;
  return null;
}

export function conversationMarkdown(items: ChatItem[]): string {
  return items
    .flatMap((item) => {
      const body = itemMarkdown(item);
      return body ? [`## ${item.kind === "user" ? "ユーザー" : "Claude"}\n\n${body}`] : [];
    })
    .join("\n\n");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // httpでLANから開いた場合などClipboard APIが使えない環境向け
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}
