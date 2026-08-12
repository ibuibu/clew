import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { query } from "@anthropic-ai/claude-agent-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3456;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    res.writeHead(404).end("Not Found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

// ユーザーメッセージを query() の streaming input に流すためのキュー
function createInputQueue() {
  const queue = [];
  let notify = null;
  let closed = false;
  return {
    push(message) {
      queue.push(message);
      notify?.();
    },
    close() {
      closed = true;
      notify?.();
    },
    async *iterate() {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift();
        } else if (closed) {
          return;
        } else {
          await new Promise((resolve) => (notify = resolve));
        }
      }
    },
  };
}

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  let session = null;

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  function startSession({ cwd, permissionMode }) {
    const input = createInputQueue();
    const pendingPermissions = new Map();
    let permissionSeq = 0;

    const q = query({
      prompt: input.iterate(),
      options: {
        cwd: cwd || process.cwd(),
        permissionMode: permissionMode || "default",
        includePartialMessages: true,
        settingSources: ["project"],
        canUseTool: async (toolName, toolInput, { signal }) => {
          const id = `perm_${++permissionSeq}`;
          send({ type: "permission_request", id, toolName, input: toolInput });
          return new Promise((resolve) => {
            pendingPermissions.set(id, { resolve, toolInput });
            signal?.addEventListener("abort", () => {
              if (pendingPermissions.delete(id)) {
                send({ type: "permission_cancelled", id });
                resolve({ behavior: "deny", message: "Cancelled" });
              }
            });
          });
        },
      },
    });

    session = { input, q, pendingPermissions };

    (async () => {
      try {
        for await (const message of q) {
          handleSdkMessage(message);
        }
        send({ type: "session_closed" });
      } catch (err) {
        send({ type: "error", message: String(err?.message || err) });
      }
    })();
  }

  function handleSdkMessage(message) {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          send({
            type: "init",
            sessionId: message.session_id,
            model: message.model,
            cwd: message.cwd,
          });
        }
        break;
      case "stream_event": {
        const event = message.event;
        if (event.type === "content_block_start") {
          send({ type: "block_start", block: event.content_block, index: event.index });
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            send({ type: "text_delta", text: event.delta.text, index: event.index });
          } else if (event.delta.type === "input_json_delta") {
            send({ type: "tool_input_delta", partial: event.delta.partial_json, index: event.index });
          } else if (event.delta.type === "thinking_delta") {
            send({ type: "thinking_delta", text: event.delta.thinking, index: event.index });
          }
        } else if (event.type === "content_block_stop") {
          send({ type: "block_stop", index: event.index });
        }
        break;
      }
      case "user":
        // ツール実行結果（エラーだけ通知する）
        for (const block of [].concat(message.message?.content || [])) {
          if (block?.type === "tool_result" && block.is_error) {
            const text = Array.isArray(block.content)
              ? block.content.filter((c) => c.type === "text").map((c) => c.text).join("\n")
              : String(block.content ?? "");
            send({ type: "tool_error", text: text.slice(0, 2000) });
          }
        }
        break;
      case "result":
        send({
          type: "result",
          subtype: message.subtype,
          costUsd: message.total_cost_usd,
          numTurns: message.num_turns,
          durationMs: message.duration_ms,
        });
        break;
    }
  }

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "start":
        if (!session) startSession(msg);
        break;
      case "user_message":
        if (!session) startSession(msg);
        session.input.push({
          type: "user",
          message: { role: "user", content: msg.text },
          parent_tool_use_id: null,
        });
        break;
      case "permission_response": {
        const pending = session?.pendingPermissions.get(msg.id);
        if (pending) {
          session.pendingPermissions.delete(msg.id);
          pending.resolve(
            msg.behavior === "allow"
              ? { behavior: "allow", updatedInput: pending.toolInput }
              : { behavior: "deny", message: msg.message || "User denied" }
          );
        }
        break;
      }
      case "interrupt":
        try {
          await session?.q.interrupt();
        } catch (err) {
          send({ type: "error", message: `interrupt failed: ${err?.message || err}` });
        }
        break;
    }
  });

  ws.on("close", () => {
    if (session) {
      for (const [, pending] of session.pendingPermissions) {
        pending.resolve({ behavior: "deny", message: "Client disconnected" });
      }
      session.pendingPermissions.clear();
      session.input.close();
      session.q.interrupt?.().catch(() => {});
    }
  });
});

server.listen(PORT, () => {
  console.log(`claude-web: http://localhost:${PORT}`);
});
