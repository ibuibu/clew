import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { IncomingMessage, JsonRpcId } from "./protocol.js";

const CODEX_BIN = process.env.CLEW_CODEX_BIN || "codex";

// clewは専用の質問UIを持っているので request_user_input を使えるようにする。
// ツールは experimental_request_user_input_enabled で登録され、planモード以外でも
// 出せるようにするには default_mode_request_user_input が要る。
// 後者は開発中の機能で、有効にすると会話の先頭に警告が入るので黙らせる。
const ARGS = [
  "app-server",
  "-c",
  "experimental_request_user_input_enabled=true",
  "--enable",
  "default_mode_request_user_input",
  "-c",
  "suppress_unstable_features_warning=true",
  "--stdio",
];

export type ThreadListener = {
  onNotification: (method: string, params: Record<string, unknown>) => void;
  // app-serverが落ちたとき。セッションは次のメッセージで作り直す
  onCrash: (message: string) => void;
  // サーバー発のリクエスト。応答すべき値を返す。
  // requestId は serverRequest/resolved と突き合わせて待ち受けを畳むのに使う
  onRequest: (
    method: string,
    params: Record<string, unknown>,
    requestId: JsonRpcId,
  ) => Promise<unknown>;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

// codex app-server を1プロセスだけ持ち、複数スレッドを多重化する。
// Claude側はセッションごとにプロセスを持つが、app-serverは1本でスレッドを並列に扱える。
class AppServerClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private handshake: Promise<void> | null = null;
  private pending = new Map<JsonRpcId, Pending>();
  private threads = new Map<string, ThreadListener>();
  private seq = 0;
  private buf = "";
  private stderr = "";

  async ensure(): Promise<void> {
    if (this.handshake) return this.handshake;
    this.handshake = this.start().catch((err) => {
      // 次の呼び出しでやり直せるように失敗は覚えない
      this.handshake = null;
      throw err;
    });
    return this.handshake;
  }

  private async start(): Promise<void> {
    const proc = spawn(CODEX_BIN, ARGS, { stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;
    this.buf = "";
    this.stderr = "";

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    // 認証エラーなどの原因はstderrにしか出ないため、落ちたときの通知に混ぜる
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-2000);
    });

    const spawned = new Promise<void>((resolve, reject) => {
      proc.once("spawn", resolve);
      proc.once("error", (err) =>
        reject(new Error(`codex app-server を起動できません: ${err.message}`)),
      );
    });
    proc.on("exit", (code) => this.onExit(code));
    await spawned;

    await this.call("initialize", {
      clientInfo: { name: "clew", title: "clew", version: "0.1.0" },
      // collaborationMode（planモード）を turn/start に渡すのに必要
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized", {});
  }

  private onExit(code: number | null) {
    this.proc = null;
    this.handshake = null;
    const detail = this.stderr.trim();
    const message = `codex app-server が終了しました (code ${code})${detail ? `: ${detail}` : ""}`;
    for (const [, p] of this.pending) p.reject(new Error(message));
    this.pending.clear();
    const listeners = [...this.threads.values()];
    this.threads.clear();
    for (const listener of listeners) listener.onCrash(message);
  }

  private onStdout(chunk: string) {
    this.buf += chunk;
    let newline: number;
    while ((newline = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, newline).trim();
      this.buf = this.buf.slice(newline + 1);
      if (!line) continue;
      let msg: IncomingMessage;
      try {
        msg = JSON.parse(line) as IncomingMessage;
      } catch {
        console.warn("codex app-server: 解釈できない行", line.slice(0, 200));
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: IncomingMessage) {
    const params = (msg.params ?? {}) as Record<string, unknown>;
    if (msg.method && msg.id !== undefined) {
      void this.handleRequest(msg.id, msg.method, params);
      return;
    }
    if (msg.method) {
      const threadId = typeof params.threadId === "string" ? params.threadId : null;
      if (!threadId) return;
      this.threads.get(threadId)?.onNotification(msg.method, params);
      return;
    }
    if (msg.id === undefined) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.error) pending.reject(new Error(msg.error.message));
    else pending.resolve(msg.result ?? null);
  }

  private async handleRequest(id: JsonRpcId, method: string, params: Record<string, unknown>) {
    const threadId = typeof params.threadId === "string" ? params.threadId : null;
    const listener = threadId ? this.threads.get(threadId) : undefined;
    if (!listener) {
      // 応答しないとターンが止まったままになる
      this.send({ id, error: { code: -32601, message: `unhandled: ${method}` } });
      return;
    }
    try {
      this.send({ id, result: await listener.onRequest(method, params, id) });
    } catch (err) {
      this.send({ id, error: { code: -32603, message: String((err as Error)?.message ?? err) } });
    }
  }

  private send(msg: Record<string, unknown>) {
    this.proc?.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private notify(method: string, params: unknown) {
    this.send({ method, params });
  }

  async call<T>(method: string, params: unknown): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.send({ id, method, params });
    });
  }

  // ハンドシェイクを済ませてから呼ぶ
  async request<T>(method: string, params: unknown): Promise<T> {
    await this.ensure();
    return this.call<T>(method, params);
  }

  registerThread(threadId: string, listener: ThreadListener) {
    this.threads.set(threadId, listener);
  }

  unregisterThread(threadId: string) {
    this.threads.delete(threadId);
  }
}

export const appServer = new AppServerClient();
