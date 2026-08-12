import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import { useActiveSession, type ChatItem } from "../store";

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="max-w-[80%] self-end whitespace-pre-wrap rounded-xl bg-sky-900/60 px-3.5 py-2.5 text-sm leading-relaxed">
          {item.text}
        </div>
      );
    case "text":
      return (
        <div className="markdown max-w-[95%] self-start rounded-xl bg-zinc-800 px-3.5 py-2.5 text-sm leading-relaxed">
          <Markdown>{item.text}</Markdown>
        </div>
      );
    case "thinking":
      return (
        <div className="max-w-[95%] self-start whitespace-pre-wrap px-3.5 py-1 text-[13px] italic leading-relaxed text-zinc-500">
          {item.text}
        </div>
      );
    case "tool": {
      let pretty = item.inputJson;
      if (item.done) {
        try {
          pretty = JSON.stringify(JSON.parse(item.inputJson || "{}"), null, 2);
        } catch {
          /* JSONとして不完全ならそのまま表示 */
        }
      }
      return (
        <details className="max-w-[95%] self-start overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800/70 text-[13px]">
          <summary className="cursor-pointer px-3 py-1.5 text-zinc-400">
            🔧 <span className="font-bold text-orange-400">{item.name}</span>
            {!item.done && <span className="ml-2 text-zinc-500">…</span>}
          </summary>
          <pre className="overflow-x-auto border-t border-zinc-700 px-3 py-2 text-xs text-zinc-400">{pretty}</pre>
        </details>
      );
    }
    case "toolError":
      return <div className="px-3.5 py-1 text-[13px] text-red-400">⚠ {item.text}</div>;
    case "meta":
      return <div className="self-center px-3.5 py-0.5 text-xs text-zinc-500">{item.text}</div>;
  }
}

export function MessageList() {
  const session = useActiveSession();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [session?.items]);

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        新しいセッション — 下からメッセージを送って開始
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5 px-4 py-5">
        {session.items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
        {session.isRunning && (
          <div className="self-start px-3.5 text-[13px] text-zinc-500">考え中…</div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
