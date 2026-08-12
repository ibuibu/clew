import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

// ユーザーメッセージを query() の streaming input に流すためのキュー
export function createInputQueue() {
  const queue: SDKUserMessage[] = [];
  let notify: (() => void) | null = null;
  let closed = false;

  return {
    push(message: SDKUserMessage) {
      queue.push(message);
      notify?.();
    },
    close() {
      closed = true;
      notify?.();
    },
    async *iterate(): AsyncGenerator<SDKUserMessage> {
      while (true) {
        const next = queue.shift();
        if (next) {
          yield next;
        } else if (closed) {
          return;
        } else {
          await new Promise<void>((resolve) => (notify = resolve));
        }
      }
    },
  };
}

export type InputQueue = ReturnType<typeof createInputQueue>;
