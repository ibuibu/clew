import { z } from "zod";

// ---------- 共通 ----------

export const agentKindSchema = z.enum(["claude", "codex"]);
export type AgentKind = z.infer<typeof agentKindSchema>;

export const permissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

// Codexの承認モード。approvalPolicy と sandbox の組をひとまとめにした呼び名
export const codexModeSchema = z.enum([
  "plan",
  "readOnly",
  "untrusted",
  "onRequest",
  "auto",
  "never",
  "fullAccess",
]);
export type CodexMode = z.infer<typeof codexModeSchema>;

// エージェントによって選べる値が違うため、両方を受け付ける
export const sessionModeSchema = z.union([permissionModeSchema, codexModeSchema]);
export type SessionMode = z.infer<typeof sessionModeSchema>;

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

export type UsageWindow = {
  // 表示用のウィンドウ名（例: "5時間", "週", "週 (Fable)"）
  label: string;
  usedPercent: number;
  // ウィンドウが空くエポックミリ秒。返らないことがある
  resetsAt: number | null;
};

export type AgentUsage = {
  agent: AgentKind;
  // 契約プラン（例: "team"）。APIキー利用などでは返らない
  plan: string | null;
  windows: UsageWindow[];
  // 取得できなかったときの理由。windowsは空になる
  error: string | null;
};

// サイドバーで手動に作るまとまり（Claude Desktopのプロジェクトに相当）
export type SessionGroup = { id: string; name: string };

export type SessionMeta = {
  sessionId: string;
  title: string;
  cwd: string;
  agent: AgentKind;
  // 未所属は undefined
  groupId?: string;
  // 任意の文字列タグ。候補は既存セッションのタグから集める
  tags?: string[];
  // ユーザーが自分で付けた名前。自動タイトルの対象外にする
  titleManual?: boolean;
  // 自動タイトルを付け終わったか。未生成なら次のターンでも試す
  titleAuto?: boolean;
  permissionMode: SessionMode;
  // 実際に使われているモデル名（SDKのinitが報告する）
  model?: string;
  // ユーザーが選択したモデル（未指定 = Claude Codeの設定に従う）
  modelPref?: string;
  status: "running" | "idle";
  totalCost: number;
  // 累計のトークン数
  tokens?: TokenUsage;
  // Claudeのみ。直近ターンのコンテキスト占有量
  context?: ContextUsage;
};

export type TokenUsage = { input: number; output: number };

// usedはターンごとの値で、compactが走ると減る
export type ContextUsage = { used: number; window: number };

// ---------- クライアント → サーバー ----------

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user_message"),
    // 省略時は新しいセッションを作成する
    sessionId: z.string().optional(),
    // 画像だけを送る場合は空文字になる
    text: z.string(),
    // POST /api/upload が返したURL（例: /uploads/xxxx.png）
    images: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    // 新規セッション作成時のエージェント指定。省略時はclaude
    agent: agentKindSchema.optional(),
    permissionMode: sessionModeSchema.optional(),
    // 新規セッション作成時のモデル指定。省略時はエージェント側の設定に従う
    model: z.string().optional(),
  }),
  z.object({
    // 入力欄の「!」から始まる行。エージェントを通さず作業ディレクトリで直接実行する
    type: z.literal("bash_command"),
    // 省略時は新しいセッションを作成する
    sessionId: z.string().optional(),
    command: z.string().min(1),
    cwd: z.string().optional(),
    agent: agentKindSchema.optional(),
    permissionMode: sessionModeSchema.optional(),
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
    mode: sessionModeSchema,
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
  z.object({
    type: z.literal("create_group"),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal("rename_group"),
    id: z.string(),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal("delete_group"),
    id: z.string(),
  }),
  z.object({
    type: z.literal("rename_session"),
    sessionId: z.string(),
    title: z.string().min(1),
  }),
  z.object({
    type: z.literal("set_session_tags"),
    sessionId: z.string(),
    tags: z.array(z.string()),
  }),
  z.object({
    type: z.literal("add_quick_reply"),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("delete_quick_reply"),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("reorder_session"),
    sessionId: z.string(),
    // このセッションの直前へ移す。省略時は末尾
    beforeSessionId: z.string().optional(),
  }),
  z.object({
    // 候補から消し、付いているセッションからも外す
    type: z.literal("delete_tag"),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal("set_session_group"),
    sessionId: z.string(),
    // 省略でグループから外す
    groupId: z.string().optional(),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------- セッション内イベント（履歴として保存・リプレイされる） ----------

export type SessionEvent =
  | { type: "user_echo"; text: string; images?: string[] }
  | { type: "block_start"; index: number; block: ContentBlockInfo }
  | { type: "text_delta"; index: number; text: string }
  | { type: "thinking_delta"; index: number; text: string }
  | { type: "tool_input_delta"; index: number; partial: string }
  | { type: "block_stop"; index: number }
  | { type: "tool_error"; text: string }
  // bashモードの実行。開始時に入力を出し、終わってから出力を足す
  | { type: "bash_input"; id: string; command: string }
  | { type: "bash_output"; id: string; output: string; exitCode: number | null }
  | {
      type: "result";
      subtype: string;
      costUsd: number;
      numTurns: number;
      durationMs: number;
      // 累計のトークン数
      tokens?: TokenUsage;
      // Claudeのみ
      context?: ContextUsage;
    }
  | { type: "error"; message: string }
  | { type: "session_closed" };

// Sessionクラスがマネージャへ渡す出力（イベント + 要応答系）
export type SessionOutput =
  | SessionEvent
  | { type: "init"; model: string; cwd: string; sdkSessionId: string }
  | { type: "cwd_changed"; cwd: string }
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
  | {
      type: "state_sync";
      sessions: SessionSnapshot[];
      groups: SessionGroup[];
      tags: string[];
      quickReplies: string[];
    }
  | { type: "groups"; groups: SessionGroup[] }
  // セッションから外しても候補に残る、これまで使われたタグの一覧
  | { type: "tags"; tags: string[] }
  // ワンタップで送る定型文
  | { type: "quick_replies"; items: string[] }
  // サイドバーの並び順（セッションid）
  | { type: "session_order"; order: string[] }
  | { type: "session_created"; meta: SessionMeta }
  | { type: "session_meta"; meta: SessionMeta }
  | { type: "session_removed"; sessionId: string }
  | { type: "event"; sessionId: string; event: SessionEvent }
  | { type: "permission_request"; sessionId: string; id: string; toolName: string; input: unknown }
  | { type: "permission_cancelled"; sessionId: string; id: string }
  | { type: "question_request"; sessionId: string; id: string; questions: QuestionInfo[] }
  | { type: "question_cancelled"; sessionId: string; id: string };
