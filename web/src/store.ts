import { create } from "zustand";
import type { ServerMessage } from "@claude-web/shared";

export type ChatItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "thinking"; text: string }
  | { id: string; kind: "tool"; name: string; inputJson: string; done: boolean }
  | { id: string; kind: "toolError"; text: string }
  | { id: string; kind: "meta"; text: string };

export type PendingPermission = { id: string; toolName: string; input: unknown };

type SessionInfo = { sessionId: string; model: string; cwd: string };

interface ChatState {
  connected: boolean;
  items: ChatItem[];
  isRunning: boolean;
  permission: PendingPermission | null;
  session: SessionInfo | null;
  totalCost: number;

  setConnected: (v: boolean) => void;
  addUserMessage: (text: string) => void;
  clearPermission: () => void;
  handleServer: (msg: ServerMessage) => void;
}

let seq = 0;
const nextId = () => `item_${++seq}`;

// ストリーミング中のcontent block index → ChatItem id
const blockToItem = new Map<number, string>();

function updateItem(items: ChatItem[], id: string, patch: (item: ChatItem) => ChatItem): ChatItem[] {
  return items.map((item) => (item.id === id ? patch(item) : item));
}

export const useChatStore = create<ChatState>((set) => ({
  connected: false,
  items: [],
  isRunning: false,
  permission: null,
  session: null,
  totalCost: 0,

  setConnected: (v) => set({ connected: v }),

  addUserMessage: (text) =>
    set((s) => ({
      items: [...s.items, { id: nextId(), kind: "user", text }],
      isRunning: true,
    })),

  clearPermission: () => set({ permission: null }),

  handleServer: (msg) =>
    set((s) => {
      switch (msg.type) {
        case "init":
          return { session: { sessionId: msg.sessionId, model: msg.model, cwd: msg.cwd } };

        case "block_start": {
          const id = nextId();
          blockToItem.set(msg.index, id);
          const item: ChatItem =
            msg.block.type === "tool_use"
              ? { id, kind: "tool", name: msg.block.name, inputJson: "", done: false }
              : { id, kind: msg.block.type, text: "" };
          return { items: [...s.items, item] };
        }

        case "text_delta":
        case "thinking_delta": {
          const id = blockToItem.get(msg.index);
          if (!id) return s;
          return {
            items: updateItem(s.items, id, (item) =>
              "text" in item ? { ...item, text: item.text + msg.text } : item,
            ),
          };
        }

        case "tool_input_delta": {
          const id = blockToItem.get(msg.index);
          if (!id) return s;
          return {
            items: updateItem(s.items, id, (item) =>
              item.kind === "tool" ? { ...item, inputJson: item.inputJson + msg.partial } : item,
            ),
          };
        }

        case "block_stop": {
          const id = blockToItem.get(msg.index);
          blockToItem.delete(msg.index);
          if (!id) return s;
          return {
            items: updateItem(s.items, id, (item) =>
              item.kind === "tool" ? { ...item, done: true } : item,
            ),
          };
        }

        case "permission_request":
          return { permission: { id: msg.id, toolName: msg.toolName, input: msg.input } };

        case "permission_cancelled":
          return s.permission?.id === msg.id ? { permission: null } : s;

        case "tool_error":
          return { items: [...s.items, { id: nextId(), kind: "toolError", text: msg.text }] };

        case "result": {
          blockToItem.clear();
          const meta = `完了 (${msg.numTurns}ターン / $${msg.costUsd.toFixed(4)} / ${(msg.durationMs / 1000).toFixed(1)}s)`;
          return {
            items: [...s.items, { id: nextId(), kind: "meta", text: meta }],
            isRunning: false,
            totalCost: s.totalCost + msg.costUsd,
          };
        }

        case "error":
          return {
            items: [...s.items, { id: nextId(), kind: "toolError", text: `エラー: ${msg.message}` }],
            isRunning: false,
          };

        case "session_closed":
          return {
            items: [...s.items, { id: nextId(), kind: "meta", text: "セッション終了" }],
            isRunning: false,
          };

        default:
          return s;
      }
    }),
}));
