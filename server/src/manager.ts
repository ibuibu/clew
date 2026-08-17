import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type {
  PermissionMode,
  QuestionInfo,
  ServerMessage,
  SessionEvent,
  SessionGroup,
  SessionMeta,
  SessionOutput,
  SessionSnapshot,
} from "@clew/shared";
import { Session } from "./session.js";
import { Storage } from "./storage.js";
import { generateTitle } from "./title.js";
import { deleteUploads, readUpload } from "./uploads.js";

const MAX_HISTORY = 5000;

type ManagedSession = {
  id: string;
  // 復元直後は null。最初のメッセージ送信時に resume 付きで起動する
  agent: Session | null;
  meta: SessionMeta;
  history: SessionEvent[];
  sdkSessionId: string | null;
  // ユーザーが選んだモデル（null = Claude Codeの設定に従う）
  modelPref: string | null;
  pendingPermission?: { id: string; toolName: string; input: unknown };
  pendingQuestion?: { id: string; questions: QuestionInfo[] };
};

// セッションをWS接続から独立して保持する。
// クライアントは接続時に state_sync で全セッションの履歴を受け取り、以降はブロードキャストを購読する。
// meta/履歴はSQLiteに永続化され、サーバー再起動後はAgent SDKの resume で会話コンテキストを復元する。
export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private clients = new Set<WebSocket>();
  private groups: SessionGroup[];

  constructor(private storage: Storage) {
    this.groups = storage.loadGroups();
    for (const persisted of storage.loadAll()) {
      // 再起動をまたいだ「実行中」は存在しない
      persisted.meta.status = "idle";
      this.sessions.set(persisted.meta.sessionId, {
        id: persisted.meta.sessionId,
        agent: null,
        meta: persisted.meta,
        history: persisted.history,
        sdkSessionId: persisted.sdkSessionId,
        modelPref: persisted.modelPref,
      });
    }
  }

  addClient(ws: WebSocket) {
    this.clients.add(ws);
    const snapshots: SessionSnapshot[] = [...this.sessions.values()].map((s) => ({
      meta: s.meta,
      events: s.history,
      pendingPermission: s.pendingPermission,
      pendingQuestion: s.pendingQuestion,
    }));
    this.sendTo(ws, { type: "state_sync", sessions: snapshots, groups: this.groups });
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
    permissionMode?: PermissionMode;
    model?: string;
  }): ManagedSession {
    const id = randomUUID().slice(0, 8);
    const meta: SessionMeta = {
      sessionId: id,
      title: "",
      cwd: opts.cwd || process.cwd(),
      permissionMode: opts.permissionMode || "default",
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
    };
    this.sessions.set(id, managed);
    this.ensureAgent(managed);
    this.persist(managed);
    this.broadcast({ type: "session_created", meta });
    return managed;
  }

  private ensureAgent(s: ManagedSession) {
    if (s.agent) return;
    s.agent = new Session(
      {
        cwd: s.meta.cwd,
        permissionMode: s.meta.permissionMode,
        resume: s.sdkSessionId ?? undefined,
        model: s.modelPref ?? undefined,
      },
      (out) => this.onSessionOutput(s, out),
    );
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
        s.meta.totalCost += out.costUsd;
        this.pushEvent(s, out);
        this.persist(s);
        this.broadcast({ type: "session_meta", meta: s.meta });
        // 最初のターンが終わった時点の内容でタイトルを付け直す
        const isFirstResult = s.history.filter((e) => e.type === "result").length === 1;
        if (isFirstResult && !s.meta.titleManual) void this.autoTitle(s);
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
    permissionMode?: PermissionMode;
    model?: string;
  }) {
    const images = msg.images ?? [];
    if (!msg.text && images.length === 0) return;
    let s = msg.sessionId ? this.sessions.get(msg.sessionId) : undefined;
    s ??= this.createSession({ cwd: msg.cwd, permissionMode: msg.permissionMode, model: msg.model });
    this.ensureAgent(s);
    if (!s.meta.title) s.meta.title = msg.text.slice(0, 40) || `画像${images.length}枚`;
    s.meta.status = "running";
    // 履歴にはURLだけを残す。base64を持つとDBが肥大化する
    this.pushEvent(s, { type: "user_echo", text: msg.text, images });
    this.persist(s);
    this.broadcast({ type: "session_meta", meta: s.meta });
    const attachments = images.flatMap((url) => {
      const found = readUpload(url);
      return found ? [{ mediaType: found.mediaType, base64: found.bytes.toString("base64") }] : [];
    });
    s.agent!.pushUserMessage(msg.text, attachments);
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

  async setPermissionMode(sessionId: string, mode: PermissionMode) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.meta.permissionMode = mode;
    if (s.agent) await s.agent.setPermissionMode(mode);
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
    this.storage.delete(sessionId);
    this.broadcast({ type: "session_removed", sessionId });
  }
}
