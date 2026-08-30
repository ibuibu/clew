import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type {
  AgentKind,
  QuestionInfo,
  ServerMessage,
  SessionEvent,
  SessionGroup,
  SessionMeta,
  SessionMode,
  SessionOutput,
  SessionSnapshot,
} from "@clew/shared";
import { runBash } from "./bash.js";
import { ClaudeAgent } from "./agents/claude.js";
import { CodexAgent } from "./agents/codex/agent.js";
import type { AgentBackend, Attachment } from "./agents/types.js";
import { Storage } from "./storage.js";
import { generateTitle } from "./title.js";
import { deleteUploads, resolveUpload } from "./uploads.js";

const MAX_HISTORY = 5000;

type ManagedSession = {
  id: string;
  // 復元直後は null。最初のメッセージ送信時に resume 付きで起動する
  agent: AgentBackend | null;
  meta: SessionMeta;
  history: SessionEvent[];
  sdkSessionId: string | null;
  // ユーザーが選んだモデル（null = Claude Codeの設定に従う）
  modelPref: string | null;
  pendingPermission?: { id: string; toolName: string; input: unknown };
  pendingQuestion?: { id: string; questions: QuestionInfo[] };
  // bashモードの実行結果。次のユーザーメッセージに添えてエージェントへ渡す
  pendingBash: BashRun[];
};

type BashRun = { command: string; output: string; exitCode: number | null };

// セッションをWS接続から独立して保持する。
// クライアントは接続時に state_sync で全セッションの履歴を受け取り、以降はブロードキャストを購読する。
// meta/履歴はSQLiteに永続化され、サーバー再起動後はAgent SDKの resume で会話コンテキストを復元する。
export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private clients = new Set<WebSocket>();
  private groups: SessionGroup[];
  // 一度でも使われたタグ。セッションから外しても候補として残す
  private knownTags: string[];
  // サイドバーの並び順（セッションid）
  private order: string[] = [];
  // ワンタップで送る定型文
  private quickReplies: string[];

  constructor(private storage: Storage) {
    this.groups = storage.loadGroups();
    this.knownTags = storage.loadTags();
    this.quickReplies = storage.loadQuickReplies();
    for (const persisted of storage.loadAll()) {
      // 再起動をまたいだ「実行中」は存在しない
      persisted.meta.status = "idle";
      // codex対応より前に保存されたセッションはclaudeとして扱う
      persisted.meta.agent ??= "claude";
      this.sessions.set(persisted.meta.sessionId, {
        id: persisted.meta.sessionId,
        agent: null,
        meta: persisted.meta,
        history: persisted.history,
        sdkSessionId: persisted.sdkSessionId,
        modelPref: persisted.modelPref,
        pendingBash: [],
      });
    }
    // 保存済みの順を優先し、そこに無いセッションは更新順で後ろに付ける
    const saved = storage.loadOrder().filter((id) => this.sessions.has(id));
    this.order = [...saved, ...[...this.sessions.keys()].filter((id) => !saved.includes(id))];
  }

  addClient(ws: WebSocket) {
    this.clients.add(ws);
    const snapshots: SessionSnapshot[] = this.order.flatMap((id) => {
      const s = this.sessions.get(id);
      return s
        ? [
            {
              meta: s.meta,
              events: s.history,
              pendingPermission: s.pendingPermission,
              pendingQuestion: s.pendingQuestion,
            },
          ]
        : [];
    });
    this.sendTo(ws, {
      type: "state_sync",
      sessions: snapshots,
      groups: this.groups,
      tags: this.knownTags,
      quickReplies: this.quickReplies,
    });
  }

  removeClient(ws: WebSocket) {
    this.clients.delete(ws);
  }

  private sendTo(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage) {
    for (const ws of this.clients) this.sendTo(ws, msg);
  }

  private persist(s: ManagedSession) {
    this.storage.save({
      meta: s.meta,
      history: s.history,
      sdkSessionId: s.sdkSessionId,
      modelPref: s.modelPref,
    });
  }

  private createSession(opts: {
    cwd?: string;
    agent?: AgentKind;
    permissionMode?: SessionMode;
    model?: string;
  }): ManagedSession {
    const id = randomUUID().slice(0, 8);
    const agent = opts.agent ?? "claude";
    const meta: SessionMeta = {
      sessionId: id,
      title: "",
      cwd: opts.cwd || process.cwd(),
      agent,
      permissionMode: opts.permissionMode ?? (agent === "codex" ? "onRequest" : "default"),
      status: "idle",
      totalCost: 0,
      modelPref: opts.model,
    };
    const managed: ManagedSession = {
      id,
      agent: null,
      meta,
      history: [],
      sdkSessionId: null,
      modelPref: opts.model ?? null,
      pendingBash: [],
    };
    this.sessions.set(id, managed);
    this.order.push(id);
    this.storage.saveOrder(this.order);
    this.ensureAgent(managed);
    this.persist(managed);
    this.broadcast({ type: "session_created", meta });
    return managed;
  }

  private ensureAgent(s: ManagedSession) {
    if (s.agent) return;
    const opts = {
      cwd: s.meta.cwd,
      mode: s.meta.permissionMode,
      resume: s.sdkSessionId ?? undefined,
      model: s.modelPref ?? undefined,
    };
    const send = (out: SessionOutput) => this.onSessionOutput(s, out);
    s.agent =
      s.meta.agent === "codex" ? new CodexAgent(opts, send) : new ClaudeAgent(opts, send);
  }

  private onSessionOutput(s: ManagedSession, out: SessionOutput) {
    // closeSession のあとにエージェントの終了イベントが遅れて届くと、
    // 消したはずのセッションが persist() でDBに書き戻されてしまう
    if (!this.sessions.has(s.id)) return;

    switch (out.type) {
      case "init":
        s.meta.model = out.model;
        s.meta.cwd = out.cwd;
        s.sdkSessionId = out.sdkSessionId;
        this.persist(s);
        this.broadcast({ type: "session_meta", meta: s.meta });
        return;

      case "cwd_changed":
        s.meta.cwd = out.cwd;
        this.persist(s);
        this.broadcast({ type: "session_meta", meta: s.meta });
        return;

      case "permission_request":
        s.pendingPermission = { id: out.id, toolName: out.toolName, input: out.input };
        this.broadcast({ ...out, sessionId: s.id });
        return;

      case "permission_cancelled":
        s.pendingPermission = undefined;
        this.broadcast({ ...out, sessionId: s.id });
        return;

      case "question_request":
        s.pendingQuestion = { id: out.id, questions: out.questions };
        this.broadcast({ ...out, sessionId: s.id });
        return;

      case "question_cancelled":
        s.pendingQuestion = undefined;
        this.broadcast({ ...out, sessionId: s.id });
        return;

      case "result": {
        s.meta.status = "idle";
        // SDKはクエリ全体の累計を毎ターン返すので、加算せず上書きする
        s.meta.totalCost = out.costUsd || s.meta.totalCost;
        if (out.tokens) s.meta.tokens = out.tokens;
        if (out.context) s.meta.context = out.context;
        this.pushEvent(s, out);
        this.persist(s);
        this.broadcast({ type: "session_meta", meta: s.meta });
        // まだ自動タイトルが付いていなければ、ターンが終わるたびに試す。
        // 履歴の件数で判定すると、再起動をまたいだセッションや生成に失敗したときに
        // 二度と付け直されない
        if (!s.meta.titleAuto && !s.meta.titleManual) void this.autoTitle(s);
        return;
      }

      case "error":
      case "session_closed":
        s.meta.status = "idle";
        // agentは終了している。次のメッセージ時に resume で作り直す
        s.agent = null;
        this.pushEvent(s, out);
        this.persist(s);
        this.broadcast({ type: "session_meta", meta: s.meta });
        return;

      default:
        this.pushEvent(s, out);
    }
  }

  private async autoTitle(s: ManagedSession) {
    const userText = s.history.find((e) => e.type === "user_echo")?.text ?? "";
    const replyText = s.history
      .filter((e) => e.type === "text_delta")
      .map((e) => e.text)
      .join("");
    if (!userText && !replyText) return;

    const title = await generateTitle(userText, replyText);
    // 生成を待つ間に削除されたり、ユーザーが自分で名前を付けた可能性がある
    if (!title || !this.sessions.has(s.id) || s.meta.titleManual) return;
    s.meta.title = title;
    s.meta.titleAuto = true;
    this.persist(s);
    this.broadcast({ type: "session_meta", meta: s.meta });
  }

  private pushEvent(s: ManagedSession, event: SessionEvent) {
    s.history.push(event);
    if (s.history.length > MAX_HISTORY) s.history.splice(0, s.history.length - MAX_HISTORY);
    this.broadcast({ type: "event", sessionId: s.id, event });
  }

  handleUserMessage(msg: {
    sessionId?: string;
    text: string;
    images?: string[];
    cwd?: string;
    agent?: AgentKind;
    permissionMode?: SessionMode;
    model?: string;
  }) {
    const images = msg.images ?? [];
    if (!msg.text && images.length === 0) return;
    let s = msg.sessionId ? this.sessions.get(msg.sessionId) : undefined;
    s ??= this.createSession({
      cwd: msg.cwd,
      agent: msg.agent,
      permissionMode: msg.permissionMode,
      model: msg.model,
    });
    this.ensureAgent(s);
    if (!s.meta.title) s.meta.title = msg.text.slice(0, 40) || `画像${images.length}枚`;
    s.meta.status = "running";
    // 履歴にはURLだけを残す。base64を持つとDBが肥大化する
    this.pushEvent(s, { type: "user_echo", text: msg.text, images });
    this.persist(s);
    this.broadcast({ type: "session_meta", meta: s.meta });
    const attachments: Attachment[] = images.flatMap((url) => {
      const found = resolveUpload(url);
      return found ? [{ url, path: found.path, mediaType: found.mediaType }] : [];
    });
    s.agent!.pushUserMessage(withPendingBash(s, msg.text), attachments);
  }

  // 入力欄のbashモード。エージェントのターンは回さず、結果は次のメッセージに添えて渡す
  async runBashCommand(msg: {
    sessionId?: string;
    command: string;
    cwd?: string;
    agent?: AgentKind;
    permissionMode?: SessionMode;
    model?: string;
  }) {
    let s = msg.sessionId ? this.sessions.get(msg.sessionId) : undefined;
    s ??= this.createSession({
      cwd: msg.cwd,
      agent: msg.agent,
      permissionMode: msg.permissionMode,
      model: msg.model,
    });
    if (!s.meta.title) {
      s.meta.title = msg.command.slice(0, 40);
      this.broadcast({ type: "session_meta", meta: s.meta });
    }
    // 複数のコマンドが並行しても対応付けられるようidを振る
    const runId = randomUUID().slice(0, 8);
    this.pushEvent(s, { type: "bash_input", id: runId, command: msg.command });
    const { output, exitCode } = await runBash(msg.command, s.meta.cwd);
    // 実行中にセッションを消された場合は捨てる
    if (!this.sessions.has(s.id)) return;
    this.pushEvent(s, { type: "bash_output", id: runId, output, exitCode });
    s.pendingBash.push({ command: msg.command, output, exitCode });
    this.persist(s);
  }

  resolvePermission(sessionId: string, id: string, behavior: "allow" | "deny", message?: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.pendingPermission?.id === id) {
      s.pendingPermission = undefined;
      this.broadcast({ type: "permission_cancelled", sessionId, id });
    }
    s.agent?.resolvePermission(id, behavior, message);
  }

  resolveQuestion(sessionId: string, id: string, answers?: Record<string, string>) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.pendingQuestion?.id === id) {
      s.pendingQuestion = undefined;
      this.broadcast({ type: "question_cancelled", sessionId, id });
    }
    s.agent?.resolveQuestion(id, answers);
  }

  async interrupt(sessionId: string) {
    await this.sessions.get(sessionId)?.agent?.interrupt();
  }

  async setModel(sessionId: string, model?: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.modelPref = model ?? null;
    s.meta.modelPref = model;
    if (s.agent) await s.agent.setModel(model);
    this.persist(s);
    this.broadcast({ type: "session_meta", meta: s.meta });
  }

  async setPermissionMode(sessionId: string, mode: SessionMode) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.meta.permissionMode = mode;
    if (s.agent) await s.agent.setMode(mode);
    this.persist(s);
    this.broadcast({ type: "session_meta", meta: s.meta });
  }

  private saveGroups() {
    this.storage.saveGroups(this.groups);
    this.broadcast({ type: "groups", groups: this.groups });
  }

  createGroup(name: string) {
    this.groups.push({ id: randomUUID().slice(0, 8), name });
    this.saveGroups();
  }

  renameGroup(id: string, name: string) {
    const group = this.groups.find((g) => g.id === id);
    if (!group) return;
    group.name = name;
    this.saveGroups();
  }

  deleteGroup(id: string) {
    if (!this.groups.some((g) => g.id === id)) return;
    this.groups = this.groups.filter((g) => g.id !== id);
    this.saveGroups();
    // 中のセッションは消さず、未所属に戻す
    for (const s of this.sessions.values()) {
      if (s.meta.groupId !== id) continue;
      s.meta.groupId = undefined;
      this.persist(s);
      this.broadcast({ type: "session_meta", meta: s.meta });
    }
  }

  renameSession(sessionId: string, title: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.meta.title = title.trim().slice(0, 100);
    // 自動タイトルで上書きしない
    s.meta.titleManual = true;
    this.persist(s);
    this.broadcast({ type: "session_meta", meta: s.meta });
  }

  setSessionTags(sessionId: string, tags: string[]) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    const cleaned = [...new Set(tags.map((t) => t.trim()).filter(Boolean).map((t) => t.slice(0, 30)))];
    s.meta.tags = cleaned.slice(0, 20);
    this.persist(s);
    this.broadcast({ type: "session_meta", meta: s.meta });
    this.rememberTags(s.meta.tags);
  }

  addQuickReply(text: string) {
    const value = text.trim().slice(0, 60);
    if (!value || this.quickReplies.includes(value)) return;
    this.quickReplies = [...this.quickReplies, value];
    this.storage.saveQuickReplies(this.quickReplies);
    this.broadcast({ type: "quick_replies", items: this.quickReplies });
  }

  deleteQuickReply(text: string) {
    if (!this.quickReplies.includes(text)) return;
    this.quickReplies = this.quickReplies.filter((t) => t !== text);
    this.storage.saveQuickReplies(this.quickReplies);
    this.broadcast({ type: "quick_replies", items: this.quickReplies });
  }

  reorderSession(sessionId: string, beforeSessionId?: string) {
    if (!this.sessions.has(sessionId) || sessionId === beforeSessionId) return;
    const rest = this.order.filter((id) => id !== sessionId);
    const at = beforeSessionId ? rest.indexOf(beforeSessionId) : -1;
    this.order = at < 0 ? [...rest, sessionId] : [...rest.slice(0, at), sessionId, ...rest.slice(at)];
    this.storage.saveOrder(this.order);
    this.broadcast({ type: "session_order", order: this.order });

    // 落とした先の行と同じグループに入れる
    const target = beforeSessionId ? this.sessions.get(beforeSessionId) : undefined;
    if (target) this.setSessionGroup(sessionId, target.meta.groupId);
  }

  deleteTag(name: string) {
    if (this.knownTags.includes(name)) {
      this.knownTags = this.knownTags.filter((t) => t !== name);
      this.storage.saveTags(this.knownTags);
      this.broadcast({ type: "tags", tags: this.knownTags });
    }
    // 付いたままだと候補に復活してしまうので、各セッションからも外す
    for (const s of this.sessions.values()) {
      if (!s.meta.tags?.includes(name)) continue;
      s.meta.tags = s.meta.tags.filter((t) => t !== name);
      this.persist(s);
      this.broadcast({ type: "session_meta", meta: s.meta });
    }
  }

  private rememberTags(tags: string[]) {
    const added = tags.filter((t) => !this.knownTags.includes(t));
    if (added.length === 0) return;
    this.knownTags = [...this.knownTags, ...added].sort((a, b) => a.localeCompare(b));
    this.storage.saveTags(this.knownTags);
    this.broadcast({ type: "tags", tags: this.knownTags });
  }

  setSessionGroup(sessionId: string, groupId?: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (groupId && !this.groups.some((g) => g.id === groupId)) return;
    s.meta.groupId = groupId;
    this.persist(s);
    this.broadcast({ type: "session_meta", meta: s.meta });
  }

  closeSession(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.agent?.dispose();
    deleteUploads(s.history.flatMap((e) => (e.type === "user_echo" ? (e.images ?? []) : [])));
    this.sessions.delete(sessionId);
    this.order = this.order.filter((id) => id !== sessionId);
    this.storage.saveOrder(this.order);
    this.storage.delete(sessionId);
    this.broadcast({ type: "session_removed", sessionId });
  }
}

// Claude Codeのbashモードと同じ形で渡す。モデルが自分の実行結果と混同しないよう入力も添える
function withPendingBash(s: ManagedSession, text: string): string {
  if (s.pendingBash.length === 0) return text;
  const blocks = s.pendingBash.map((run) => {
    const status = run.exitCode === 0 ? "" : ` exit-code="${run.exitCode ?? "unknown"}"`;
    return `<bash-input>${run.command}</bash-input>\n<bash-output${status}>${run.output}</bash-output>`;
  });
  s.pendingBash = [];
  return [...blocks, text].filter(Boolean).join("\n\n");
}
