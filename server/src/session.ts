import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionMode, ServerMessage } from "@claude-web/shared";
import { createInputQueue, type InputQueue } from "./input-queue.js";

type PendingPermission = {
  resolve: (result: { behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }) => void;
  toolInput: Record<string, unknown>;
};

export class Session {
  private input: InputQueue;
  private q: Query;
  private pendingPermissions = new Map<string, PendingPermission>();
  private permissionSeq = 0;

  constructor(
    opts: { cwd?: string; permissionMode?: PermissionMode },
    private send: (msg: ServerMessage) => void,
  ) {
    this.input = createInputQueue();

    this.q = query({
      prompt: this.input.iterate(),
      options: {
        cwd: opts.cwd || process.cwd(),
        permissionMode: opts.permissionMode || "default",
        includePartialMessages: true,
        settingSources: ["project"],
        canUseTool: async (toolName, toolInput, { signal }) => {
          const id = `perm_${++this.permissionSeq}`;
          this.send({ type: "permission_request", id, toolName, input: toolInput });
          return new Promise((resolve) => {
            this.pendingPermissions.set(id, { resolve, toolInput });
            signal?.addEventListener("abort", () => {
              if (this.pendingPermissions.delete(id)) {
                this.send({ type: "permission_cancelled", id });
                resolve({ behavior: "deny", message: "Cancelled" });
              }
            });
          });
        },
      },
    });

    void this.pump();
  }

  private async pump() {
    try {
      for await (const message of this.q) {
        this.handleSdkMessage(message);
      }
      this.send({ type: "session_closed" });
    } catch (err) {
      this.send({ type: "error", message: String((err as Error)?.message ?? err) });
    }
  }

  private handleSdkMessage(message: SDKMessage) {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          this.send({
            type: "init",
            sessionId: message.session_id,
            model: message.model,
            cwd: message.cwd,
          });
        }
        break;

      case "stream_event": {
        const event = message.event;
        if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "text" || block.type === "thinking") {
            this.send({ type: "block_start", index: event.index, block: { type: block.type } });
          } else if (block.type === "tool_use") {
            this.send({
              type: "block_start",
              index: event.index,
              block: { type: "tool_use", name: block.name },
            });
          }
        } else if (event.type === "content_block_delta") {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            this.send({ type: "text_delta", index: event.index, text: delta.text });
          } else if (delta.type === "input_json_delta") {
            this.send({ type: "tool_input_delta", index: event.index, partial: delta.partial_json });
          } else if (delta.type === "thinking_delta") {
            this.send({ type: "thinking_delta", index: event.index, text: delta.thinking });
          }
        } else if (event.type === "content_block_stop") {
          this.send({ type: "block_stop", index: event.index });
        }
        break;
      }

      case "user": {
        // ツール実行結果（エラーだけ通知する）
        const content = message.message?.content;
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (block.type === "tool_result" && block.is_error) {
            const text = Array.isArray(block.content)
              ? block.content
                  .filter((c): c is { type: "text"; text: string } => c.type === "text")
                  .map((c) => c.text)
                  .join("\n")
              : String(block.content ?? "");
            this.send({ type: "tool_error", text: text.slice(0, 2000) });
          }
        }
        break;
      }

      case "result":
        this.send({
          type: "result",
          subtype: message.subtype,
          costUsd: message.total_cost_usd,
          numTurns: message.num_turns,
          durationMs: message.duration_ms,
        });
        break;
    }
  }

  pushUserMessage(text: string) {
    this.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: "",
    });
  }

  resolvePermission(id: string, behavior: "allow" | "deny", message?: string) {
    const pending = this.pendingPermissions.get(id);
    if (!pending) return;
    this.pendingPermissions.delete(id);
    pending.resolve(
      behavior === "allow"
        ? { behavior: "allow", updatedInput: pending.toolInput }
        : { behavior: "deny", message: message || "User denied" },
    );
  }

  async interrupt() {
    await this.q.interrupt();
  }

  dispose() {
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve({ behavior: "deny", message: "Client disconnected" });
    }
    this.pendingPermissions.clear();
    this.input.close();
    this.q.interrupt().catch(() => {});
  }
}
