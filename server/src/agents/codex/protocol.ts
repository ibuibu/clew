// codex app-server の JSON-RPC のうち clew が使う部分だけを写した型。
// 全体は `codex app-server generate-ts` で出せるが642ファイルあるため取り込まない。
// app-server は experimental 扱いで、Codexのバージョンアップで形が変わりうる。

export type JsonRpcId = number | string;

export type IncomingMessage = {
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type AskForApproval = "untrusted" | "on-request" | "never";

// 承認リクエストの宛先。auto_reviewはサブエージェントがリスクを判定して自動で承認/拒否する
export type ApprovalsReviewer = "user" | "auto_review";

export type SandboxPolicy =
  | { type: "dangerFullAccess" }
  | { type: "readOnly"; networkAccess: boolean }
  | {
      type: "workspaceWrite";
      writableRoots: string[];
      networkAccess: boolean;
      excludeTmpdirEnvVar: boolean;
      excludeSlashTmp: boolean;
    };

// plan では request_user_input が使えるようになる。default では出てこない
export type CollaborationMode = {
  mode: "plan" | "default";
  settings: { model: string; reasoning_effort: null; developer_instructions: null };
};

export type UserInput =
  | { type: "text"; text: string }
  | { type: "localImage"; path: string };

export type ThreadStartResponse = {
  thread: { id: string; path: string | null };
  model: string;
  cwd: string;
};

export type TurnStartResponse = { turn: { id: string } };

// clewが表示に使う種類だけを書く。これ以外のitemも届くので、扱う側は既定の分岐を用意する
export type ThreadItem =
  | { type: "userMessage"; id: string }
  | { type: "agentMessage"; id: string; text: string }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      status: "inProgress" | "completed" | "failed" | "declined";
      aggregatedOutput: string | null;
      exitCode: number | null;
    }
  | {
      type: "fileChange";
      id: string;
      changes: { path: string; kind: { type: "add" | "delete" | "update" }; diff: string }[];
      status: "inProgress" | "completed" | "failed" | "declined";
    }
  | {
      type: "mcpToolCall";
      id: string;
      server: string;
      tool: string;
      arguments: unknown;
      status: "inProgress" | "completed" | "failed";
      error: { message: string } | null;
    }
  | { type: "webSearch"; id: string; query: string }
  | { type: "plan"; id: string; text: string }
  | { type: "error"; id: string; message: string };

export type ItemNotification = { threadId: string; turnId: string; item: ThreadItem };
export type DeltaNotification = { threadId: string; turnId: string; itemId: string; delta: string };

export type TurnCompletedNotification = {
  threadId: string;
  turn: {
    id: string;
    status: "completed" | "interrupted" | "failed";
    error: { message: string } | null;
    durationMs: number | null;
  };
};

export type RateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  // ウィンドウが空くエポック秒
  resetsAt: number | null;
};

export type RateLimitsResponse = {
  rateLimits: {
    primary: RateLimitWindow | null;
    secondary: RateLimitWindow | null;
    planType: string | null;
  };
};

// 自動レビューの結果。[UNSTABLE] と明記された形なのでCodexの更新で変わりうる
export type AutoApprovalReviewNotification = {
  threadId: string;
  review: {
    status: "inProgress" | "approved" | "denied" | "timedOut" | "aborted";
    riskLevel: "low" | "medium" | "high" | "critical" | null;
    rationale: string | null;
  };
};

export type TokenUsageNotification = {
  threadId: string;
  tokenUsage: { total: { inputTokens: number; outputTokens: number } };
};

export type ErrorNotification = {
  threadId: string;
  error: { message: string };
  willRetry: boolean;
};

export type CommandApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  approvalId?: string | null;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
};

export type FileChangeApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  grantRoot?: string | null;
};

export type PermissionsApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  cwd: string;
  reason: string | null;
  permissions: unknown;
};

export type RequestUserInputParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: {
    id: string;
    header: string;
    question: string;
    isOther?: boolean;
    isSecret?: boolean;
    options: { label: string; description: string }[] | null;
  }[];
};

export type ModelListResponse = {
  data: {
    id: string;
    model: string;
    displayName: string;
    description: string;
    hidden: boolean;
    isDefault: boolean;
  }[];
};

export type SkillsListResponse = {
  data: { cwd: string; skills: { name: string; description: string; enabled: boolean }[] }[];
};
