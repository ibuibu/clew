import type { ClientMessage, ServerMessage } from "@clew/shared";
import { useChatStore } from "./store";

let ws: WebSocket | null = null;

export function connect() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}/ws`);

  ws.onopen = () => useChatStore.getState().setConnected(true);
  ws.onclose = () => useChatStore.getState().setConnected(false);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data) as ServerMessage;
    useChatStore.getState().handleServer(msg);
  };
}

export function send(msg: ClientMessage) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
