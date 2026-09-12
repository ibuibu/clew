import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import {
  agentKindSchema,
  clientMessageSchema,
  createSessionBodySchema,
  sessionMessageBodySchema,
} from "@clew/shared";
import { SessionManager } from "./manager.js";
import { Storage } from "./storage.js";
import { listGhqRepos } from "./repos.js";
import { listModels } from "./models.js";
import { listCommands } from "./commands.js";
import { readUsage, startUsagePolling } from "./usage.js";
import { MAX_UPLOAD_BYTES, isSupportedImage, readUpload, saveUpload } from "./uploads.js";

const PORT = Number(process.env.PORT) || 3456;
// エージェントのプロセスに引き継ぐ。セッションから自分のclewのAPIを叩けるようにする
process.env.CLEW_URL = `http://localhost:${PORT}`;

const app = new Hono();
const manager = new SessionManager(new Storage());

app.get("/api/repos", async (c) => {
  return c.json(await listGhqRepos());
});
// 省略や未知の値はclaude扱いにする
const agentOf = (value?: string) => agentKindSchema.safeParse(value).data ?? "claude";

app.get("/api/models", async (c) => {
  try {
    return c.json(await listModels(agentOf(c.req.query("agent"))));
  } catch (err) {
    console.warn("listModels failed:", err);
    return c.json([]);
  }
});
app.get("/api/commands", async (c) => {
  const cwd = c.req.query("cwd") || process.cwd();
  try {
    return c.json(await listCommands(agentOf(c.req.query("agent")), cwd));
  } catch (err) {
    console.warn("listCommands failed:", err);
    return c.json([]);
  }
});
app.get("/api/usage", async (c) => c.json(await readUsage()));

app.post("/api/upload", async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: "file がありません" }, 400);
  if (!isSupportedImage(file.type)) return c.json({ error: `未対応の形式: ${file.type}` }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: "画像が大きすぎます（最大10MB）" }, 413);
  const url = saveUpload(file.type, Buffer.from(await file.arrayBuffer()));
  return c.json({ url });
});

app.get("/uploads/:name", (c) => {
  const found = readUpload(c.req.param("name"));
  if (!found) return c.notFound();
  return c.body(new Uint8Array(found.bytes), 200, {
    "Content-Type": found.mediaType,
    "Cache-Control": "public, max-age=31536000, immutable",
  });
});

// セッションを外から立てて監視するためのAPI。
// 司令塔セッションがworker（子セッション）を作るのに使う。入口はWSのuser_messageと同じなので、
// 立てたworkerはそのままブラウザで開いて会話に割り込める
const readJson = async (c: { req: { json: () => Promise<unknown> } }) =>
  await c.req.json().catch(() => null);

app.post("/api/sessions", async (c) => {
  const body = createSessionBodySchema.safeParse(await readJson(c));
  if (!body.success) return c.json({ error: body.error.message }, 400);
  const { mode, ...rest } = body.data;
  const sessionId = manager.handleUserMessage({ ...rest, permissionMode: mode });
  if (!sessionId) return c.json({ error: "セッションを作成できませんでした" }, 500);
  return c.json({ sessionId });
});

// parent を付けるとそのセッションのworkerだけを返す。空文字なら親を持たないものだけ
app.get("/api/sessions", (c) => {
  const parent = c.req.query("parent");
  return c.json(manager.listSessionMetas(parent === undefined ? undefined : parent));
});

app.get("/api/sessions/:id", (c) => {
  const found = manager.describeSession(c.req.param("id"));
  if (!found) return c.json({ error: "セッションがありません" }, 404);
  return c.json(found);
});

app.post("/api/sessions/:id/message", async (c) => {
  const body = sessionMessageBodySchema.safeParse(await readJson(c));
  if (!body.success) return c.json({ error: body.error.message }, 400);
  const sessionId = manager.handleUserMessage({ sessionId: c.req.param("id"), text: body.data.text });
  if (!sessionId) return c.json({ error: "セッションがありません" }, 404);
  return c.json({ sessionId });
});

// ブラウザの✕と同じ扱いでゴミ箱に入れる。7日以内なら復元できる
app.delete("/api/sessions/:id", (c) => {
  const id = c.req.param("id");
  if (!manager.describeSession(id)) return c.json({ error: "セッションがありません" }, 404);
  manager.closeSession(id);
  return c.json({ ok: true });
});

app.post("/api/sessions/:id/interrupt", async (c) => {
  const id = c.req.param("id");
  if (!manager.describeSession(id)) return c.json({ error: "セッションがありません" }, 404);
  await manager.interrupt(id);
  return c.json({ ok: true });
});

// 本番用: web/dist をビルドしてあれば配信する（開発時はVite dev serverを使う）
app.use("/*", serveStatic({ root: "../web/dist" }));

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`clew server: http://localhost:${info.port}`);
});

const wss = new WebSocketServer({ server: server as Server, path: "/ws" });

startUsagePolling((usage) => manager.publishUsage(usage));

wss.on("connection", (ws: WebSocket) => {
  manager.addClient(ws);

  ws.on("message", async (raw) => {
    const parsed = clientMessageSchema.safeParse(JSON.parse(raw.toString()));
    if (!parsed.success) {
      console.warn("invalid client message:", parsed.error.message);
      return;
    }
    const msg = parsed.data;

    switch (msg.type) {
      case "user_message":
        manager.handleUserMessage(msg);
        break;
      case "bash_command":
        await manager.runBashCommand(msg).catch((err) => {
          console.warn("bash_command failed:", err);
        });
        break;
      case "permission_response":
        manager.resolvePermission(msg.sessionId, msg.id, msg.behavior, msg.message);
        break;
      case "question_response":
        manager.resolveQuestion(msg.sessionId, msg.id, msg.answers);
        break;
      case "interrupt":
        await manager.interrupt(msg.sessionId).catch((err) => {
          console.warn("interrupt failed:", err);
        });
        break;
      case "set_model":
        await manager.setModel(msg.sessionId, msg.model).catch((err) => {
          console.warn("set_model failed:", err);
        });
        break;
      case "set_effort":
        await manager.setEffort(msg.sessionId, msg.effort).catch((err) => {
          console.warn("set_effort failed:", err);
        });
        break;
      case "set_permission_mode":
        await manager.setPermissionMode(msg.sessionId, msg.mode).catch((err) => {
          console.warn("set_permission_mode failed:", err);
        });
        break;
      case "close_session":
        manager.closeSession(msg.sessionId);
        break;
      case "restore_session":
        manager.restoreSession(msg.sessionId);
        break;
      case "purge_session":
        manager.purgeSession(msg.sessionId);
        break;
      case "empty_trash":
        manager.emptyTrash();
        break;
      case "create_group":
        manager.createGroup(msg.name);
        break;
      case "rename_group":
        manager.renameGroup(msg.id, msg.name);
        break;
      case "delete_group":
        manager.deleteGroup(msg.id);
        break;
      case "add_quick_reply":
        manager.addQuickReply(msg.text);
        break;
      case "delete_quick_reply":
        manager.deleteQuickReply(msg.text);
        break;
      case "reorder_session":
        manager.reorderSession(msg.sessionId, msg.beforeSessionId);
        break;
      case "delete_tag":
        manager.deleteTag(msg.name);
        break;
      case "set_session_group":
        manager.setSessionGroup(msg.sessionId, msg.groupId);
        break;
      case "set_session_tags":
        manager.setSessionTags(msg.sessionId, msg.tags);
        break;
      case "rename_session":
        manager.renameSession(msg.sessionId, msg.title);
        break;
    }
  });

  ws.on("close", () => {
    manager.removeClient(ws);
  });
});
