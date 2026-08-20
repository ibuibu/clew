import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import { clientMessageSchema } from "@clew/shared";
import { SessionManager } from "./manager.js";
import { Storage } from "./storage.js";
import { listGhqRepos, listWorktrees } from "./repos.js";
import { listModels } from "./models.js";
import { listCommands } from "./commands.js";
import { MAX_UPLOAD_BYTES, isSupportedImage, readUpload, saveUpload } from "./uploads.js";

const PORT = Number(process.env.PORT) || 3456;

const app = new Hono();
app.get("/api/repos", async (c) => {
  const [repos, worktrees] = await Promise.all([listGhqRepos(), listWorktrees()]);
  return c.json([...repos, ...worktrees]);
});
app.get("/api/models", async (c) => c.json(await listModels()));
app.get("/api/commands", async (c) => {
  const cwd = c.req.query("cwd") || process.cwd();
  try {
    return c.json(await listCommands(cwd));
  } catch (err) {
    console.warn("listCommands failed:", err);
    return c.json([]);
  }
});
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

// 本番用: web/dist をビルドしてあれば配信する（開発時はVite dev serverを使う）
app.use("/*", serveStatic({ root: "../web/dist" }));

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`clew server: http://localhost:${info.port}`);
});

const wss = new WebSocketServer({ server: server as Server, path: "/ws" });
const manager = new SessionManager(new Storage());

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
      case "set_permission_mode":
        await manager.setPermissionMode(msg.sessionId, msg.mode).catch((err) => {
          console.warn("set_permission_mode failed:", err);
        });
        break;
      case "close_session":
        manager.closeSession(msg.sessionId);
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
