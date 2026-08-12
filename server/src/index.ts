import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import { clientMessageSchema } from "@claude-web/shared";
import { SessionManager } from "./manager.js";
import { Storage } from "./storage.js";
import { listGhqRepos } from "./repos.js";

const PORT = Number(process.env.PORT) || 3456;

const app = new Hono();
app.get("/api/repos", async (c) => c.json(await listGhqRepos()));
// 本番用: web/dist をビルドしてあれば配信する（開発時はVite dev serverを使う）
app.use("/*", serveStatic({ root: "../web/dist" }));

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`claude-web server: http://localhost:${info.port}`);
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
      case "close_session":
        manager.closeSession(msg.sessionId);
        break;
    }
  });

  ws.on("close", () => {
    manager.removeClient(ws);
  });
});
