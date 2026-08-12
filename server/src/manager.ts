import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type {
  PermissionMode,
  QuestionInfo,
  ServerMessage,
  SessionEvent,
  SessionMeta,
  SessionOutput,
  SessionSnapshot,
} from "@claude-web/shared";
import { Session } from "./session.js";
import { Storage } from "./storage.js";

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

  constructor(private storage: Storage) {
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
    this.sendTo(ws, { type: "state_sync", sessions: snapshots });
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

      case "result":
        s.meta.status = "idle";
        s.meta.totalCost += out.costUsd;
        this.pushEvent(s, out);
        this.persist(s);
        this.broadcast({ type: "session_meta", meta: s.meta });
        return;

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

  private pushEvent(s: ManagedSession, event: SessionEvent) {
    s.history.push(event);
    if (s.history.length > MAX_HISTORY) s.history.splice(0, s.history.length - MAX_HISTORY);
    this.broadcast({ type: "event", sessionId: s.id, event });
  }

  handleUserMessage(msg: {
    sessionId?: string;
    text: string;
    cwd?: string;
    permissionMode?: PermissionMode;
    model?: string;
  }) {
    let s = msg.sessionId ? this.sessions.get(msg.sessionId) : undefined;
    s ??= this.createSession({ cwd: msg.cwd, permissionMode: msg.permissionMode, model: msg.model });
    this.ensureAgent(s);
    if (!s.meta.title) s.meta.title = msg.text.slice(0, 40);
    s.meta.status = "running";
    this.pushEvent(s, { type: "user_echo", text: msg.text });
    this.persist(s);
    this.broadcast({ type: "session_meta", meta: s.meta });
    s.agent!.pushUserMessage(msg.text);
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

  closeSession(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.agent?.dispose();
    this.sessions.delete(sessionId);
    this.storage.delete(sessionId);
    this.broadcast({ type: "session_removed", sessionId });
  }
}
