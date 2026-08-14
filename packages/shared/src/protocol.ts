import { z } from "zod";

// ---------- 共通 ----------

export const permissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export type QuestionOption = { label: string; description?: string };

export type QuestionInfo = {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
};

export type ContentBlockInfo =
  | { type: "text" }
  | { type: "thinking" }
  | { type: "tool_use"; name: string };

export type ModelChoice = {
  // query()やsetModel()に渡す値（例: "claude-fable-5[1m]", "sonnet"）
  value: string;
  displayName: string;
  description?: string;
  // この行が実際に解決されるモデルid（例: "default" → "claude-opus-5[1m]"）
  resolvedModel?: string;
};

export type SlashCommandInfo = {
  // 先頭のスラッシュを含まない名前（例: "grill-me"）
  name: string;
  description: string;
  // 引数のヒント（例: "<file>"）
  argumentHint?: string;
  aliases?: string[];
};

export type SessionMeta = {
  sessionId: string;
  title: string;
  cwd: string;
  permissionMode: PermissionMode;
  // 実際に使われているモデル名（SDKのinitが報告する）
  model?: string;
  // ユーザーが選択したモデル（未指定 = Claude Codeの設定に従う）
  modelPref?: string;
  status: "running" | "idle";
  totalCost: number;
};

// ---------- クライアント → サーバー ----------

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user_message"),
    // 省略時は新しいセッションを作成する
    sessionId: z.string().optional(),
    text: z.string().min(1),
    cwd: z.string().optional(),
    permissionMode: permissionModeSchema.optional(),
    // 新規セッション作成時のモデル指定。省略時はClaude Codeの設定に従う
    model: z.string().optional(),
  }),
  z.object({
    type: z.literal("set_model"),
    sessionId: z.string(),
    // 省略時はデフォルト（Claude Codeの設定）に戻す
    model: z.string().optional(),
  }),
  z.object({
    type: z.literal("set_permission_mode"),
    sessionId: z.string(),
    mode: permissionModeSchema,
  }),
  z.object({
    type: z.literal("permission_response"),
    sessionId: z.string(),
    id: z.string(),
    behavior: z.enum(["allow", "deny"]),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("question_response"),
    sessionId: z.string(),
    id: z.string(),
    // 質問文 → 回答（選択ラベル or 自由記述）。省略時はキャンセル扱い
    answers: z.record(z.string()).optional(),
  }),
  z.object({
    type: z.literal("interrupt"),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("close_session"),
    sessionId: z.string(),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------- セッション内イベント（履歴として保存・リプレイされる） ----------

export type SessionEvent =
  | { type: "user_echo"; text: string }
  | { type: "block_start"; index: number; block: ContentBlockInfo }
  | { type: "text_delta"; index: number; text: string }
  | { type: "thinking_delta"; index: number; text: string }
  | { type: "tool_input_delta"; index: number; partial: string }
  | { type: "block_stop"; index: number }
  | { type: "tool_error"; text: string }
  | {
      type: "result";
      subtype: string;
      costUsd: number;
      numTurns: number;
      durationMs: number;
    }
  | { type: "error"; message: string }
  | { type: "session_closed" };

// Sessionクラスがマネージャへ渡す出力（イベント + 要応答系）
export type SessionOutput =
  | SessionEvent
  | { type: "init"; model: string; cwd: string; sdkSessionId: string }
  | { type: "permission_request"; id: string; toolName: string; input: unknown }
  | { type: "permission_cancelled"; id: string }
  | { type: "question_request"; id: string; questions: QuestionInfo[] }
  | { type: "question_cancelled"; id: string };

// ---------- サーバー → クライアント ----------

export type SessionSnapshot = {
  meta: SessionMeta;
  events: SessionEvent[];
  pendingPermission?: { id: string; toolName: string; input: unknown };
  pendingQuestion?: { id: string; questions: QuestionInfo[] };
};

export type ServerMessage =
  | { type: "state_sync"; sessions: SessionSnapshot[] }
  | { type: "session_created"; meta: SessionMeta }
  | { type: "session_meta"; meta: SessionMeta }
  | { type: "session_removed"; sessionId: string }
  | { type: "event"; sessionId: string; event: SessionEvent }
  | { type: "permission_request"; sessionId: string; id: string; toolName: string; input: unknown }
  | { type: "permission_cancelled"; sessionId: string; id: string }
  | { type: "question_request"; sessionId: string; id: string; questions: QuestionInfo[] }
  | { type: "question_cancelled"; sessionId: string; id: string };
