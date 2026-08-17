import type { ClientMessage, ServerMessage } from "@clew/shared";
import { useChatStore } from "./store";

const MAX_BACKOFF_MS = 10_000;

let ws: WebSocket | null = null;
let attempt = 0;
let timer: number | null = null;

export function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }

  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}/ws`);

  ws.onopen = () => {
    attempt = 0;
    useChatStore.getState().setConnected(true);
  };
  ws.onclose = () => {
    useChatStore.getState().setConnected(false);
    reconnectLater();
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data) as ServerMessage;
    useChatStore.getState().handleServer(msg);
  };
}

// サーバー再起動中は何度も失敗するので、1秒から10秒まで間隔を広げながら試し続ける
function reconnectLater() {
  if (timer !== null) return;
  const delay = Math.min(1000 * 2 ** attempt++, MAX_BACKOFF_MS);
  timer = window.setTimeout(() => {
    timer = null;
    connect();
  }, delay);
}

// スリープ復帰やオフライン復帰は待つ理由がないので、バックオフを捨てて即座に試す
function reconnectNow() {
  attempt = 0;
  connect();
}
window.addEventListener("online", reconnectNow);
window.addEventListener("focus", reconnectNow);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) reconnectNow();
});

export function send(msg: ClientMessage) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
