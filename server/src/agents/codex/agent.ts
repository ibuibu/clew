import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { CodexMode, QuestionInfo, SessionMode, TokenUsage } from "@clew/shared";
import { appServer } from "./client.js";
import type { AgentBackend, AgentOptions, AgentSend, Attachment } from "../types.js";
import type {
  ApprovalsReviewer,
  AskForApproval,
  CollaborationMode,
  CommandApprovalParams,
  DeltaNotification,
  ErrorNotification,
  FileChangeApprovalParams,
  ItemNotification,
  JsonRpcId,
  PermissionsApprovalParams,
  RequestUserInputParams,
  SandboxPolicy,
  ThreadItem,
  ThreadStartResponse,
  AutoApprovalReviewNotification,
  TokenUsageNotification,
  TurnCompletedNotification,
  TurnStartResponse,
  UserInput,
} from "./protocol.js";

const MAX_TOOL_ERROR = 2000;

type ModeSettings = {
  approvalPolicy: AskForApproval;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  sandboxPolicy: SandboxPolicy;
  collaboration: CollaborationMode["mode"];
  approvalsReviewer: ApprovalsReviewer;
};

const WORKSPACE_WRITE: SandboxPolicy = {
  type: "workspaceWrite",
  writableRoots: [],
  networkAccess: false,
  excludeTmpdirEnvVar: false,
  excludeSlashTmp: false,
};

const READ_ONLY: SandboxPolicy = { type: "readOnly", networkAccess: false };

const MODES: Record<CodexMode, ModeSettings> = {
  plan: {
    approvalPolicy: "on-request",
    sandbox: "read-only",
    sandboxPolicy: READ_ONLY,
    collaboration: "plan",
    approvalsReviewer: "user",
  },
  readOnly: {
    approvalPolicy: "on-request",
    sandbox: "read-only",
    sandboxPolicy: READ_ONLY,
    collaboration: "default",
    approvalsReviewer: "user",
  },
  untrusted: {
    approvalPolicy: "untrusted",
    sandbox: "workspace-write",
    sandboxPolicy: WORKSPACE_WRITE,
    collaboration: "default",
    approvalsReviewer: "user",
  },
  onRequest: {
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    sandboxPolicy: WORKSPACE_WRITE,
    collaboration: "default",
    approvalsReviewer: "user",
  },
  // onRequestと同じ権限で、承認だけをCodex側のサブエージェントに任せる
  auto: {
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    sandboxPolicy: WORKSPACE_WRITE,
    collaboration: "default",
    approvalsReviewer: "auto_review",
  },
  never: {
    approvalPolicy: "never",
    sandbox: "workspace-write",
    sandboxPolicy: WORKSPACE_WRITE,
    collaboration: "default",
    approvalsReviewer: "user",
  },
  fullAccess: {
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    sandboxPolicy: { type: "dangerFullAccess" },
    collaboration: "default",
    approvalsReviewer: "user",
  },
};

const execFileAsync = promisify(execFile);

const settingsFor = (mode: SessionMode): ModeSettings => MODES[mode as CodexMode] ?? MODES.onRequest;

// PATHと同じ区切りで、ワークスペースの外にも書き込みを許すディレクトリを足せる
const EXTRA_WRITABLE_ROOTS = (process.env.CLEW_CODEX_WRITABLE_ROOTS ?? "")
  .split(path.delimiter)
  .filter(Boolean);

// workspace-write は .git を読み取り専用にするため、そのままではコミットできない。
// worktreeでは .git がファイルで実体が別にあるので、共通のgitディレクトリを解決する
async function gitWritableRoots(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd },
    );
    return [stdout.trim()];
  } catch {
    // gitリポジトリでない作業ディレクトリでは何も足さない
    return [];
  }
}

const AUTO_REVIEW_LABEL = {
  denied: "拒否しました",
  timedOut: "時間内に判定できませんでした",
  aborted: "中断されました",
} as const;

type Outgoing = { text: string; images: Attachment[] };

type PendingApproval = { requestId: JsonRpcId; resolve: (allow: boolean) => void };
type PendingQuestion = {
  requestId: JsonRpcId;
  // 表示した質問文 → Codex側の質問id
  ids: Map<string, string>;
  resolve: (answers?: Record<string, string>) => void;
};

// codex app-server の1スレッドをclewの1セッションとして扱う
export class CodexAgent implements AgentBackend {
  private threadId: string | null = null;
  private turnId: string | null = null;
  private started: Promise<void>;
  private queue: Outgoing[] = [];
  private flushing = false;
  private disposed = false;
  private mode: SessionMode;
  private model?: string;
  private cwd: string;
  private resumeId?: string;
  // workspace-write のサンドボックスで書き込みを許す、cwd以外のディレクトリ
  private writableRoots: string[] = [];
  // itemId → 表示ブロックのindex。clewのイベントはindexで組み立てられている
  private blocks = new Map<string, number>();
  private blockSeq = 0;
  private items = new Map<string, ThreadItem>();
  private pendingApprovals = new Map<string, PendingApproval>();
  private pendingQuestions = new Map<string, PendingQuestion>();
  private promptSeq = 0;
  private tokens: TokenUsage | undefined;
  private lastError: string | null = null;
  // 実際に使われているモデル。collaborationMode の設定に必要
  private activeModel: string | null = null;

  constructor(opts: AgentOptions, private send: AgentSend) {
    this.cwd = opts.cwd;
    this.mode = opts.mode;
    this.model = opts.model;
    this.resumeId = opts.resume;
    this.started = this.begin();
    // 起動に失敗しても未処理のrejectionにしない。失敗は flush() で受け取って会話ペインに出す
    this.started.catch(() => {});
  }

  private async begin() {
    await appServer.ensure();
    this.writableRoots = [...(await gitWritableRoots(this.cwd)), ...EXTRA_WRITABLE_ROOTS];
    const settings = settingsFor(this.mode);
    const params = {
      cwd: this.cwd,
      approvalPolicy: settings.approvalPolicy,
      approvalsReviewer: settings.approvalsReviewer,
      sandbox: settings.sandbox,
      model: this.model,
    };
    let res: ThreadStartResponse;
    if (this.resumeId) {
      try {
        res = await appServer.call<ThreadStartResponse>("thread/resume", {
          threadId: this.resumeId,
          ...params,
        });
      } catch {
        // セッションファイルが消えていることがある。その場合は新しいスレッドで続ける
        res = await appServer.call<ThreadStartResponse>("thread/start", params);
      }
    } else {
      res = await appServer.call<ThreadStartResponse>("thread/start", params);
    }
    this.threadId = res.thread.id;
    this.activeModel = res.model;
    appServer.registerThread(this.threadId, {
      onNotification: (method, notifParams) => this.onNotification(method, notifParams),
      onCrash: (message) => this.onCrash(message),
      onRequest: (method, requestParams, requestId) =>
        this.onRequest(method, requestParams, requestId),
    });
    this.send({ type: "init", model: res.model, cwd: res.cwd, sdkSessionId: this.threadId });
  }

  private onCrash(message: string) {
    this.threadId = null;
    this.turnId = null;
    this.rejectPending("codex app-server が終了しました");
    this.send({ type: "error", message });
  }

  private rejectPending(_reason: string) {
    for (const [id, pending] of this.pendingApprovals) {
      this.send({ type: "permission_cancelled", id });
      pending.resolve(false);
    }
    this.pendingApprovals.clear();
    for (const [id, pending] of this.pendingQuestions) {
      this.send({ type: "question_cancelled", id });
      pending.resolve(undefined);
    }
    this.pendingQuestions.clear();
  }

  // ---------- 入力 ----------

  pushUserMessage(text: string, images: Attachment[] = []) {
    this.queue.push({ text, images });
    void this.flush();
  }

  private async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      await this.started;
      while (this.queue.length > 0 && !this.disposed && this.threadId) {
        const next = this.queue.shift()!;
        const input: UserInput[] = [
          ...next.images.map((image) => ({ type: "localImage" as const, path: image.path })),
          ...(next.text ? [{ type: "text" as const, text: next.text }] : []),
        ];
        await this.deliver(input);
      }
    } catch (err) {
      this.send({ type: "error", message: String((err as Error)?.message ?? err) });
    } finally {
      this.flushing = false;
    }
  }

  // thread/start はサンドボックスのモード名しか受け取らないため、
  // 書き込み可能なディレクトリは turn/start のポリシーで渡す
  private sandboxPolicy(settings: ModeSettings): SandboxPolicy {
    const policy = settings.sandboxPolicy;
    return policy.type === "workspaceWrite"
      ? { ...policy, writableRoots: this.writableRoots }
      : policy;
  }

  private async deliver(input: UserInput[]) {
    const settings = settingsFor(this.mode);
    if (this.turnId) {
      try {
        await appServer.call("turn/steer", {
          threadId: this.threadId,
          input,
          expectedTurnId: this.turnId,
        });
        return;
      } catch {
        // ターンが終わった直後だと steer は失敗する。新しいターンとして送り直す
      }
    }
    const model = this.model ?? this.activeModel;
    const res = await appServer.call<TurnStartResponse>("turn/start", {
      threadId: this.threadId,
      input,
      approvalPolicy: settings.approvalPolicy,
      approvalsReviewer: settings.approvalsReviewer,
      sandboxPolicy: this.sandboxPolicy(settings),
      model: this.model,
      // planモードでしか request_user_input が使えないので、モードごとに切り替える
      collaborationMode: model
        ? {
            mode: settings.collaboration,
            settings: { model, reasoning_effort: null, developer_instructions: null },
          }
        : undefined,
    });
    this.turnId = res.turn.id;
  }

  // ---------- 通知 ----------

  private blockIndex(itemId: string): number | null {
    return this.blocks.get(itemId) ?? null;
  }

  // ブロックはdeltaが来て初めて作る。中身の無いreasoningで空の吹き出しを出さないため
  private ensureBlock(itemId: string, type: "text" | "thinking"): number {
    const existing = this.blocks.get(itemId);
    if (existing !== undefined) return existing;
    const index = this.blockSeq++;
    this.blocks.set(itemId, index);
    this.send({ type: "block_start", index, block: { type } });
    return index;
  }

  private onNotification(method: string, params: Record<string, unknown>) {
    switch (method) {
      case "item/started":
        this.onItemStarted((params as unknown as ItemNotification).item);
        return;
      case "item/completed":
        this.onItemCompleted((params as unknown as ItemNotification).item);
        return;
      case "item/agentMessage/delta": {
        const { itemId, delta } = params as unknown as DeltaNotification;
        this.send({ type: "text_delta", index: this.ensureBlock(itemId, "text"), text: delta });
        return;
      }
      case "item/plan/delta": {
        const { itemId, delta } = params as unknown as DeltaNotification;
        this.send({ type: "text_delta", index: this.ensureBlock(itemId, "text"), text: delta });
        return;
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        const { itemId, delta } = params as unknown as DeltaNotification;
        this.send({
          type: "thinking_delta",
          index: this.ensureBlock(itemId, "thinking"),
          text: delta,
        });
        return;
      }
      case "item/reasoning/summaryPartAdded": {
        const { itemId } = params as unknown as DeltaNotification;
        const index = this.blockIndex(itemId);
        // 区切りが分かるように空行を挟む
        if (index !== null) this.send({ type: "thinking_delta", index, text: "\n\n" });
        return;
      }
      case "turn/completed":
        this.onTurnCompleted(params as unknown as TurnCompletedNotification);
        return;
      case "thread/tokenUsage/updated": {
        const { tokenUsage } = params as unknown as TokenUsageNotification;
        this.tokens = {
          input: tokenUsage.total.inputTokens,
          output: tokenUsage.total.outputTokens,
        };
        return;
      }
      // autoモードでは承認がCodex側で判定されるため、通らなかったものだけ理由を出す
      case "item/autoApprovalReview/completed": {
        const { review } = params as unknown as AutoApprovalReviewNotification;
        if (review.status === "approved" || review.status === "inProgress") return;
        const risk = review.riskLevel ? ` (risk: ${review.riskLevel})` : "";
        const reason = review.rationale ? `: ${review.rationale}` : "";
        this.send({
          type: "tool_error",
          text: `自動承認レビューが${AUTO_REVIEW_LABEL[review.status]}${risk}${reason}`.slice(
            0,
            MAX_TOOL_ERROR,
          ),
        });
        return;
      }
      case "error": {
        const { error, willRetry } = params as unknown as ErrorNotification;
        // 再試行するものは最終的に成功しうるので出さない
        if (!willRetry) this.reportError(error.message);
        return;
      }
      case "serverRequest/resolved":
        this.onRequestResolved(params.requestId as JsonRpcId);
        return;
    }
  }

  private onItemStarted(item: ThreadItem) {
    this.items.set(item.id, item);
    const tool = toolCall(item);
    if (!tool) return;
    const index = this.blockSeq++;
    this.blocks.set(item.id, index);
    this.send({ type: "block_start", index, block: { type: "tool_use", name: tool.name } });
    this.send({ type: "tool_input_delta", index, partial: JSON.stringify(tool.input) });
  }

  private onItemCompleted(item: ThreadItem) {
    this.items.set(item.id, item);
    const index = this.blockIndex(item.id);

    // deltaが来ないまま完了することがある（キャッシュされた応答など）
    if (index === null && item.type === "agentMessage" && item.text) {
      const created = this.ensureBlock(item.id, "text");
      this.send({ type: "text_delta", index: created, text: item.text });
      this.send({ type: "block_stop", index: created });
      this.blocks.delete(item.id);
      return;
    }

    if (index !== null) {
      this.send({ type: "block_stop", index });
      this.blocks.delete(item.id);
    }

    const failure = failureText(item);
    if (failure) this.send({ type: "tool_error", text: failure.slice(0, MAX_TOOL_ERROR) });
    this.items.delete(item.id);
  }

  private onTurnCompleted(params: TurnCompletedNotification) {
    this.turnId = null;
    for (const [itemId, index] of this.blocks) {
      this.send({ type: "block_stop", index });
      this.blocks.delete(itemId);
    }
    if (params.turn.status === "failed" && params.turn.error) {
      this.reportError(params.turn.error.message);
    }
    this.lastError = null;
    this.send({
      type: "result",
      subtype: params.turn.status,
      // Codexは金額を返さない
      costUsd: 0,
      numTurns: 1,
      durationMs: params.turn.durationMs ?? 0,
      tokens: this.tokens,
    });
  }

  // 同じ失敗が error 通知と turn/completed の両方から届くので、続けて同じ文面は出さない
  private reportError(message: string) {
    if (message === this.lastError) return;
    this.lastError = message;
    this.send({ type: "tool_error", text: message.slice(0, MAX_TOOL_ERROR) });
  }

  // ---------- サーバー発のリクエスト ----------

  private async onRequest(
    method: string,
    params: Record<string, unknown>,
    requestId: JsonRpcId,
  ): Promise<unknown> {
    switch (method) {
      case "item/commandExecution/requestApproval": {
        const p = params as unknown as CommandApprovalParams;
        const allow = await this.askPermission(requestId, "Shell", {
          command: p.command ?? "",
          path: p.cwd ?? "",
          description: p.reason ?? undefined,
        });
        return { decision: allow ? "accept" : "decline" };
      }
      case "item/fileChange/requestApproval": {
        const p = params as unknown as FileChangeApprovalParams;
        const item = this.items.get(p.itemId);
        const changes = item && item.type === "fileChange" ? item.changes : [];
        const allow = await this.askPermission(requestId, "Edit", {
          path: changes.map((c) => c.path).join(", "),
          description: p.reason ?? undefined,
          changes,
        });
        return { decision: allow ? "accept" : "decline" };
      }
      case "item/permissions/requestApproval": {
        const p = params as unknown as PermissionsApprovalParams;
        const allow = await this.askPermission(requestId, "Permissions", {
          path: p.cwd,
          description: p.reason ?? undefined,
          permissions: p.permissions,
        });
        return { permissions: allow ? p.permissions : {}, scope: "turn" };
      }
      case "item/tool/requestUserInput": {
        const p = params as unknown as RequestUserInputParams;
        const answers = await this.askQuestion(requestId, p);
        return { answers };
      }
      case "mcpServer/elicitation/request":
        // MCPサーバーからの入力要求は未対応。ターンを止めないよう断る
        return { action: "decline", content: null };
      default:
        throw new Error(`unsupported request: ${method}`);
    }
  }

  private askPermission(
    requestId: JsonRpcId,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<boolean> {
    const id = `perm_${++this.promptSeq}`;
    this.send({ type: "permission_request", id, toolName, input });
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(id, { requestId, resolve });
    });
  }

  private askQuestion(
    requestId: JsonRpcId,
    params: RequestUserInputParams,
  ): Promise<Record<string, { answers: string[] }>> {
    const id = `q_${++this.promptSeq}`;
    const ids = new Map<string, string>();
    const questions: QuestionInfo[] = params.questions.map((q) => {
      ids.set(q.question, q.id);
      return {
        question: q.question,
        header: q.header,
        options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description })),
        // Codexは複数選択を持たない
        multiSelect: false,
      };
    });
    this.send({ type: "question_request", id, questions });
    return new Promise((resolve) => {
      this.pendingQuestions.set(id, {
        requestId,
        ids,
        resolve: (answers) => resolve(toCodexAnswers(answers, ids)),
      });
    });
  }

  // 中断などでサーバー側が待ち受けを畳んだら、UIのプロンプトも閉じる
  private onRequestResolved(requestId: JsonRpcId) {
    for (const [id, pending] of this.pendingApprovals) {
      if (pending.requestId !== requestId) continue;
      this.pendingApprovals.delete(id);
      this.send({ type: "permission_cancelled", id });
      return;
    }
    for (const [id, pending] of this.pendingQuestions) {
      if (pending.requestId !== requestId) continue;
      this.pendingQuestions.delete(id);
      this.send({ type: "question_cancelled", id });
      return;
    }
  }

  resolvePermission(id: string, behavior: "allow" | "deny") {
    const pending = this.pendingApprovals.get(id);
    if (!pending) return;
    this.pendingApprovals.delete(id);
    pending.resolve(behavior === "allow");
  }

  resolveQuestion(id: string, answers?: Record<string, string>) {
    const pending = this.pendingQuestions.get(id);
    if (!pending) return;
    this.pendingQuestions.delete(id);
    pending.resolve(answers);
  }

  // ---------- セッション操作 ----------

  async interrupt() {
    if (!this.threadId || !this.turnId) return;
    await appServer.call("turn/interrupt", { threadId: this.threadId, turnId: this.turnId });
  }

  // モデルとモードは次のターンの turn/start で渡す
  async setModel(model?: string) {
    this.model = model;
  }

  async setMode(mode: SessionMode) {
    this.mode = mode;
  }

  dispose() {
    this.disposed = true;
    this.queue = [];
    this.rejectPending("セッションを閉じました");
    if (this.threadId) {
      appServer.unregisterThread(this.threadId);
      void this.interrupt().catch(() => {});
    }
  }
}

// 表示用のツール名と引数。clewのUIはツール名＋入力JSONで1行サマリを作る
function toolCall(item: ThreadItem): { name: string; input: Record<string, unknown> } | null {
  switch (item.type) {
    case "commandExecution":
      return { name: "Shell", input: { command: item.command, path: item.cwd } };
    case "fileChange":
      return {
        name: "Edit",
        input: { path: item.changes.map((c) => c.path).join(", "), changes: item.changes },
      };
    case "mcpToolCall":
      return { name: `${item.server}:${item.tool}`, input: { query: item.tool, ...toObject(item.arguments) } };
    case "webSearch":
      return { name: "WebSearch", input: { query: item.query } };
    default:
      return null;
  }
}

const toObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function failureText(item: ThreadItem): string | null {
  switch (item.type) {
    case "commandExecution":
      if (item.status === "completed") return null;
      return `${item.command}\n${item.aggregatedOutput ?? ""}`.trim();
    case "fileChange":
      return item.status === "completed" ? null : `編集に失敗しました: ${item.status}`;
    case "mcpToolCall":
      return item.error ? item.error.message : null;
    case "error":
      return item.message;
    default:
      return null;
  }
}

// clewは「質問文 → 回答」で持つが、Codexは質問idをキーにした配列で返す
function toCodexAnswers(
  answers: Record<string, string> | undefined,
  ids: Map<string, string>,
): Record<string, { answers: string[] }> {
  if (!answers) return {};
  const result: Record<string, { answers: string[] }> = {};
  for (const [question, value] of Object.entries(answers)) {
    const id = ids.get(question);
    if (id) result[id] = { answers: [value] };
  }
  return result;
}
