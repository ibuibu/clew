import type { ChatItem, SessionState } from "./store";

export type SearchHit = {
  sessionId: string;
  itemId: string;
  kind: ChatItem["kind"];
  before: string;
  match: string;
  after: string;
};

// 数百件を超えると描画が重くなるだけで実用にならないので打ち切る
const MAX_HITS = 200;
const CONTEXT_BEFORE = 40;
const CONTEXT_AFTER = 140;

// metaは「セッション終了」などの定型文なので検索対象から外す
function itemText(item: ChatItem): string | null {
  switch (item.kind) {
    case "user":
    case "text":
    case "thinking":
    case "toolError":
      return item.text;
    case "bash":
      return item.output ? `${item.command}\n${item.output}` : item.command;
    case "toolGroup":
    case "meta":
      return null;
  }
}

const clean = (s: string) => s.replace(/\s+/g, " ");

function hitOf(sessionId: string, item: ChatItem, text: string, at: number, len: number): SearchHit {
  const from = Math.max(0, at - CONTEXT_BEFORE);
  const to = Math.min(text.length, at + len + CONTEXT_AFTER);
  return {
    sessionId,
    itemId: item.id,
    kind: item.kind,
    before: (from > 0 ? "…" : "") + clean(text.slice(from, at)),
    match: clean(text.slice(at, at + len)),
    after: clean(text.slice(at + len, to)) + (to < text.length ? "…" : ""),
  };
}

// セッション内で新しい発言ほど見たいことが多いので、各セッションは末尾から辿る
export function searchSessions(
  sessions: Record<string, SessionState>,
  order: string[],
  query: string,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const sessionId of order) {
    const session = sessions[sessionId];
    if (!session) continue;
    for (let i = session.items.length - 1; i >= 0; i--) {
      const item = session.items[i];
      const text = itemText(item);
      if (!text) continue;
      const at = text.toLowerCase().indexOf(q);
      if (at < 0) continue;
      hits.push(hitOf(sessionId, item, text, at, q.length));
      if (hits.length >= MAX_HITS) return hits;
    }
  }
  return hits;
}
