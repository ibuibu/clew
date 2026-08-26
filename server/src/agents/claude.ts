import {
  query,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import type { ContextUsage, PermissionMode, QuestionInfo, SessionMode } from "@clew/shared";
import { createInputQueue, type InputQueue } from "../input-queue.js";
import type { AgentBackend, AgentOptions, AgentSend, Attachment } from "./types.js";

type UserContent = SDKUserMessage["message"]["content"];

type PermissionResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

type PendingPermission = {
  resolve: (result: PermissionResult) => void;
  toolInput: Record<string, unknown>;
};

export class ClaudeAgent implements AgentBackend {
  private input: InputQueue;
  private q: Query;
  private pendingPermissions = new Map<string, PendingPermission>();
  private pendingQuestions = new Map<string, PendingPermission>();
  private permissionSeq = 0;
  private cwd: string;
  // initが報告するモデル。modelUsageから上限を引くキーに使う
  private model: string | null = null;
  // 直近1リクエストのプロンプト規模。これがコンテキスト占有量になる
  private lastContextUsed = 0;

  constructor(
    opts: AgentOptions,
    private send: AgentSend,
  ) {
    this.input = createInputQueue();
    this.cwd = opts.cwd || process.cwd();

    this.q = query({
      prompt: this.input.iterate(),
      options: {
        cwd: opts.cwd || process.cwd(),
        permissionMode: toPermissionMode(opts.mode),
        // bypassPermissions を選べるようにするためSDKが要求するフラグ
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        settingSources: ["user", "project", "local"],
        model: opts.model,
        // サーバー再起動後、Claude Code側のセッション履歴から会話を復元する
        resume: opts.resume,
        // EnterWorktree などで作業ディレクトリが移ったら追従する。
        // フック入力は毎回いまの cwd を持つので、ツール実行のたびに見て差分だけ通知する。
        // WorktreeCreate は作成先を決めるフックで、登録するとパスの返却が必須になるため使わない。
        hooks: {
          PostToolUse: [{ hooks: [async (input) => this.trackCwd(input.cwd)] }],
          CwdChanged: [{ hooks: [async (input) => this.trackCwd(input.cwd)] }],
        },
        canUseTool: async (toolName, toolInput, { signal }) => {
          // 質問ツールは専用UIへ。それ以外は権限確認モーダルへ
          if (toolName === "AskUserQuestion") {
            return this.requestQuestion(toolInput, signal);
          }
          return this.requestPermission(toolName, toolInput, signal);
        },
      },
    });

    void this.pump();
  }

  private async trackCwd(cwd: string) {
    if (cwd && cwd !== this.cwd) {
      this.cwd = cwd;
      this.send({ type: "cwd_changed", cwd });
    }
    return {};
  }

  private requestPermission(
    toolName: string,
    toolInput: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<PermissionResult> {
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
  }

  private requestQuestion(
    toolInput: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<PermissionResult> {
    const id = `q_${++this.permissionSeq}`;
    this.send({
      type: "question_request",
      id,
      questions: (toolInput.questions ?? []) as QuestionInfo[],
    });
    return new Promise((resolve) => {
      this.pendingQuestions.set(id, { resolve, toolInput });
      signal?.addEventListener("abort", () => {
        if (this.pendingQuestions.delete(id)) {
          this.send({ type: "question_cancelled", id });
          resolve({ behavior: "deny", message: "Cancelled" });
        }
      });
    });
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

  // 分子はassistantが持つ1リクエスト分のusage。resultのusageはターン内の全
  // リクエストの合計なので、ツールを何度も呼ぶと上限を超えてしまう
  private contextUsage(message: SDKResultMessage): ContextUsage | undefined {
    const usage = message.modelUsage ?? {};
    const window =
      (this.model ? usage[this.model]?.contextWindow : undefined) ??
      Math.max(0, ...Object.values(usage).map((m) => m.contextWindow ?? 0));
    if (!this.lastContextUsed || !window) return undefined;
    return { used: this.lastContextUsed, window };
  }

  private handleSdkMessage(message: SDKMessage) {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          this.model = message.model;
          this.send({
            type: "init",
            model: message.model,
            cwd: message.cwd,
            sdkSessionId: message.session_id,
          });
        }
        break;

      // 描画はstream_eventで行うが、usageはassistantメッセージにしか載らない
      case "assistant": {
        // サブエージェントは別のコンテキストを持つので除く
        if (message.parent_tool_use_id === null && !message.subagent_type) {
          const u = message.message.usage;
          this.lastContextUsed =
            (u.input_tokens ?? 0) +
            (u.output_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0);
        }
        break;
      }

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
          context: this.contextUsage(message),
        });
        break;
    }
  }

  pushUserMessage(text: string, images: Attachment[] = []) {
    // 画像がなければ従来どおり文字列で渡す（SDKのプロンプトをそのまま保つ）
    const content: UserContent = images.length
      ? [
          ...images.map((image) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: image.mediaType,
              data: fs.readFileSync(image.path).toString("base64"),
            },
          })),
          ...(text ? [{ type: "text" as const, text }] : []),
        ]
      : text;
    this.input.push({
      type: "user",
      message: { role: "user", content },
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

  resolveQuestion(id: string, answers?: Record<string, string>) {
    const pending = this.pendingQuestions.get(id);
    if (!pending) return;
    this.pendingQuestions.delete(id);
    pending.resolve(
      answers
        ? {
            behavior: "allow",
            // 契約: 元のquestionsをそのまま返しつつ answers（質問文→選択ラベル）を添える
            updatedInput: { ...pending.toolInput, answers },
          }
        : { behavior: "deny", message: "User dismissed the question" },
    );
  }

  async interrupt() {
    await this.q.interrupt();
  }

  // 実行中セッションのモデルを切り替える（ターミナルの /model 相当）
  async setModel(model?: string) {
    await this.q.setModel(model);
  }

  // 実行中セッションの権限モードを切り替える（ターミナルの Shift+Tab 相当）
  async setMode(mode: SessionMode) {
    await this.q.setPermissionMode(toPermissionMode(mode));
  }

  dispose() {
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve({ behavior: "deny", message: "Client disconnected" });
    }
    this.pendingPermissions.clear();
    for (const [, pending] of this.pendingQuestions) {
      pending.resolve({ behavior: "deny", message: "Client disconnected" });
    }
    this.pendingQuestions.clear();
    this.input.close();
    this.q.interrupt().catch(() => {});
  }
}

const PERMISSION_MODES: PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
];

// Codexのモードを持つセッションから切り替えられることはないが、型を絞るために丸める
function toPermissionMode(mode: SessionMode): PermissionMode {
  return PERMISSION_MODES.includes(mode as PermissionMode) ? (mode as PermissionMode) : "default";
}
