import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useActiveSession, useChatStore, type ChatItem, type ToolCall } from "../store";
import { PermissionPrompt } from "./PermissionPrompt";
import { QuestionPrompt } from "./QuestionPrompt";

// 1行サマリに使う引数。先に見つかったものを採用する
const SUMMARY_KEYS = [
  "command",
  "file_path",
  "pattern",
  "url",
  "query",
  "description",
  "skill",
  "path",
  "prompt",
];

// ストリーミング中は不完全なJSONなのでパースできない
function parseInput(call: ToolCall): Record<string, unknown> | null {
  if (!call.done) return null;
  try {
    return JSON.parse(call.inputJson || "{}");
  } catch {
    return null;
  }
}

function summarize(call: ToolCall): string {
  const input = parseInput(call);
  if (!input) return "";
  for (const key of SUMMARY_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value) return value.replace(/\s+/g, " ").slice(0, 200);
  }
  return "";
}

function ToolLabel({ call }: { call: ToolCall }) {
  return (
    <>
      🔧 <span className="font-bold text-accent">{call.name}</span>
      {call.done ? (
        <span className="ml-2 min-w-0 truncate font-mono text-xs text-fg-subtle">
          {summarize(call)}
        </span>
      ) : (
        <span className="ml-2 text-fg-subtle">…</span>
      )}
    </>
  );
}

function ToolCallRow({ call }: { call: ToolCall }) {
  const input = parseInput(call);
  const pretty = input ? JSON.stringify(input, null, 2) : call.inputJson;
  return (
    <details className="group/call border-t border-line">
      <summary className="flex cursor-pointer items-center px-3 py-1.5 text-fg-muted">
        <span className="mr-1.5 shrink-0 text-xs text-fg-subtle transition-transform group-open/call:rotate-90">
          ▶
        </span>
        <ToolLabel call={call} />
      </summary>
      <pre className="overflow-x-auto bg-panel px-3 py-2 text-xs text-fg-muted">{pretty}</pre>
    </details>
  );
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="max-w-[80%] self-end whitespace-pre-wrap rounded-xl border border-line bg-elevated px-3.5 py-2.5 text-[15px] leading-[1.8]">
          {item.text}
        </div>
      );
    case "text":
      return (
        <div className="markdown max-w-[95%] self-start rounded-xl border border-line bg-elevated px-4 py-3 text-[15px]">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
            }}
          >
            {item.text}
          </Markdown>
        </div>
      );
    case "thinking":
      return (
        <div className="max-w-[95%] self-start whitespace-pre-wrap px-3.5 py-1 text-[13px] italic leading-relaxed text-fg-subtle">
          {item.text}
        </div>
      );
    case "toolGroup": {
      const latest = item.calls.at(-1);
      if (!latest) return null;
      const hidden = item.calls.length - 1;
      return (
        <details className="group/group w-[95%] self-start overflow-hidden rounded-lg border border-line bg-elevated text-[13px]">
          <summary className="flex cursor-pointer items-center px-3 py-1.5 text-fg-muted">
            <span className="mr-1.5 shrink-0 text-xs text-fg-subtle transition-transform group-open/group:rotate-90">
              ▶
            </span>
            <ToolLabel call={latest} />
            {hidden > 0 && (
              <span className="ml-auto shrink-0 pl-2 text-xs text-fg-subtle">他 {hidden} 件</span>
            )}
          </summary>
          {item.calls.map((call) => (
            <ToolCallRow key={call.id} call={call} />
          ))}
        </details>
      );
    }
    case "toolError":
      return <div className="px-3.5 py-1 text-[13px] text-danger">⚠ {item.text}</div>;
    case "meta":
      return <div className="self-center px-3.5 py-0.5 text-xs text-fg-subtle">{item.text}</div>;
  }
}

export function MessageList() {
  const session = useActiveSession();
  const activeId = useChatStore((s) => s.activeId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    stickToBottom.current = true;
  }, [activeId]);

  useEffect(() => {
    if (!stickToBottom.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [session?.items, session?.permission?.id, session?.question?.id]);

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-fg-subtle">
        新しいセッション — 下からメッセージを送って開始
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5 px-4 py-5">
        {session.items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
        {session.isRunning && (
          <div className="self-start px-3.5 text-[13px] text-fg-subtle">
            考え中
            <span className="thinking-dot">.</span>
            <span className="thinking-dot">.</span>
            <span className="thinking-dot">.</span>
          </div>
        )}
        <PermissionPrompt />
        <QuestionPrompt />
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
