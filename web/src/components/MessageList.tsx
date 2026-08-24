import { Braces, ChevronRight, TriangleAlert, Wrench } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { itemMarkdown } from "../markdown";
import { useActiveSession, useChatStore, type ChatItem, type ToolCall } from "../store";
import { CopyButton } from "./CopyButton";
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

// 出し入れで高さが変わるとホバーが外れてちらつくため絶対配置にする。
// さらに吹き出しの箱の中に収める。外に出すとホバーが切れる隙間ができ、
// 隣のメッセージとホバーを取り合い、最後のメッセージでは入力欄の下に隠れてしまう
const rowCopyClass =
  "absolute bottom-1 right-1 z-50 hidden items-center rounded border border-line bg-elevated p-1 text-fg-subtle shadow-sm hover:bg-hover hover:text-fg-muted group-hover/msg:flex";

// pre は overflow-x: auto なのでボタンを中に入れると横スクロールで流れてしまう。
// 外側のラッパに対して絶対配置し、押した時点のDOMから本文を読む
function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="group/code relative">
      <pre ref={ref}>{children}</pre>
      <CopyButton
        text={() => ref.current?.textContent ?? ""}
        iconOnly
        className="absolute right-1.5 top-1.5 z-40 hidden items-center rounded border border-line bg-elevated p-1 text-fg-subtle shadow-sm hover:bg-hover hover:text-fg-muted group-hover/code:flex"
      />
    </div>
  );
}

function ToolLabel({ call }: { call: ToolCall }) {
  return (
    <>
      <Wrench size={13} className="mr-1.5 shrink-0" />
      <span className="font-bold text-accent">{call.name}</span>
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
        <Braces size={13} className="mr-1.5 shrink-0 text-fg-subtle group-open/call:text-accent" />
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
        <div className="group/msg relative flex max-w-[80%] flex-col self-end rounded-xl border border-line bg-elevated px-3.5 py-2.5 text-[16px] leading-[1.8]">
          {item.images && item.images.length > 0 && (
            <div className={`flex flex-wrap gap-2 ${item.text ? "mb-2" : ""}`}>
              {item.images.map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                  <img src={url} alt="添付画像" className="max-h-48 rounded-lg border border-line" />
                </a>
              ))}
            </div>
          )}
          {item.text && <div className="whitespace-pre-wrap">{item.text}</div>}
          <CopyButton text={itemMarkdown(item) ?? ""} className={rowCopyClass} iconOnly />
        </div>
      );
    case "text":
      return (
        <div className="group/msg markdown relative flex max-w-[95%] flex-col self-start px-3.5 py-1 text-[16px]">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
              pre: CodeBlock,
            }}
          >
            {item.text}
          </Markdown>
          <CopyButton text={item.text} className={rowCopyClass} iconOnly />
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
            <ChevronRight
              size={14}
              className="mr-1 shrink-0 text-fg-subtle transition-transform group-open/group:rotate-90"
            />
            {/* 開いている間は最新の1件を見出しに出さない。同じ内容が一覧の末尾にも並んで紛らわしいため */}
            <span className="flex min-w-0 flex-1 items-center group-open/group:hidden">
              <ToolLabel call={latest} />
            </span>
            <span className="hidden text-xs text-fg-subtle group-open/group:block">
              ツール実行 {item.calls.length} 件
            </span>
            {hidden > 0 && (
              <span className="ml-auto shrink-0 pl-2 text-xs text-fg-subtle group-open/group:hidden">
                他 {hidden} 件
              </span>
            )}
          </summary>
          {item.calls.map((call) => (
            <ToolCallRow key={call.id} call={call} />
          ))}
        </details>
      );
    }
    case "toolError":
      return (
        <div className="flex items-start gap-1.5 px-3.5 py-1 text-[13px] text-danger">
          <TriangleAlert size={14} className="mt-1 shrink-0" />
          <span className="min-w-0">{item.text}</span>
        </div>
      );
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
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-2.5 px-4 py-5">
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
