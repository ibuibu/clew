import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import { clientMessageSchema, type ServerMessage } from "@claude-web/shared";
import { Session } from "./session.js";

const PORT = Number(process.env.PORT) || 3456;

const app = new Hono();
// 本番用: web/dist をビルドしてあれば配信する（開発時はVite dev serverを使う）
app.use("/*", serveStatic({ root: "../web/dist" }));

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`claude-web server: http://localhost:${info.port}`);
});

const wss = new WebSocketServer({ server: server as Server, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  let session: Session | null = null;

  const send = (msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  ws.on("message", async (raw) => {
    const parsed = clientMessageSchema.safeParse(JSON.parse(raw.toString()));
    if (!parsed.success) {
      send({ type: "error", message: `invalid message: ${parsed.error.message}` });
      return;
    }
    const msg = parsed.data;

    switch (msg.type) {
      case "user_message":
        session ??= new Session({ cwd: msg.cwd, permissionMode: msg.permissionMode }, send);
        session.pushUserMessage(msg.text);
        break;

      case "permission_response":
        session?.resolvePermission(msg.id, msg.behavior, msg.message);
        break;

      case "interrupt":
        try {
          await session?.interrupt();
        } catch (err) {
          send({ type: "error", message: `interrupt failed: ${(err as Error).message}` });
        }
        break;
    }
  });

  ws.on("close", () => {
    session?.dispose();
    session = null;
  });
});
