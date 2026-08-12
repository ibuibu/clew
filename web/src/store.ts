import { create } from "zustand";
import type {
  QuestionInfo,
  ServerMessage,
  SessionEvent,
  SessionMeta,
} from "@claude-web/shared";

export type ChatItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "thinking"; text: string }
  | { id: string; kind: "tool"; name: string; inputJson: string; done: boolean }
  | { id: string; kind: "toolError"; text: string }
  | { id: string; kind: "meta"; text: string };

export type PendingPermission = { id: string; toolName: string; input: unknown };
export type PendingQuestion = { id: string; questions: QuestionInfo[] };

export type SessionState = {
  meta: SessionMeta;
  items: ChatItem[];
  isRunning: boolean;
  permission: PendingPermission | null;
  question: PendingQuestion | null;
};

interface ChatState {
  connected: boolean;
  sessions: Record<string, SessionState>;
  order: string[];
  // null = ドラフト状態（次のメッセージで新規セッションを作成）
  activeId: string | null;

  setConnected: (v: boolean) => void;
  setActive: (id: string | null) => void;
  handleServer: (msg: ServerMessage) => void;
}

let seq = 0;
const nextId = () => `item_${++seq}`;

// セッションごとの、ストリーミング中content block index → ChatItem id
const blockMaps = new Map<string, Map<number, string>>();
const blockMap = (sessionId: string) => {
  let m = blockMaps.get(sessionId);
  if (!m) {
    m = new Map();
    blockMaps.set(sessionId, m);
  }
  return m;
};

function updateItem(items: ChatItem[], id: string, patch: (item: ChatItem) => ChatItem): ChatItem[] {
  return items.map((item) => (item.id === id ? patch(item) : item));
}

function applyEvent(session: SessionState, sessionId: string, ev: SessionEvent): SessionState {
  const blocks = blockMap(sessionId);

  switch (ev.type) {
    case "user_echo":
      return {
        ...session,
        items: [...session.items, { id: nextId(), kind: "user", text: ev.text }],
        isRunning: true,
      };

    case "block_start": {
      const id = nextId();
      blocks.set(ev.index, id);
      const item: ChatItem =
        ev.block.type === "tool_use"
          ? { id, kind: "tool", name: ev.block.name, inputJson: "", done: false }
          : { id, kind: ev.block.type, text: "" };
      return { ...session, items: [...session.items, item] };
    }

    case "text_delta":
    case "thinking_delta": {
      const id = blocks.get(ev.index);
      if (!id) return session;
      return {
        ...session,
        items: updateItem(session.items, id, (item) =>
          "text" in item ? { ...item, text: item.text + ev.text } : item,
        ),
      };
    }

    case "tool_input_delta": {
      const id = blocks.get(ev.index);
      if (!id) return session;
      return {
        ...session,
        items: updateItem(session.items, id, (item) =>
          item.kind === "tool" ? { ...item, inputJson: item.inputJson + ev.partial } : item,
        ),
      };
    }

    case "block_stop": {
      const id = blocks.get(ev.index);
      blocks.delete(ev.index);
      if (!id) return session;
      return {
        ...session,
        items: updateItem(session.items, id, (item) =>
          item.kind === "tool" ? { ...item, done: true } : item,
        ),
      };
    }

    case "tool_error":
      return {
        ...session,
        items: [...session.items, { id: nextId(), kind: "toolError", text: ev.text }],
      };

    case "result": {
      blocks.clear();
      const meta = `完了 (${ev.numTurns}ターン / $${ev.costUsd.toFixed(4)} / ${(ev.durationMs / 1000).toFixed(1)}s)`;
      return {
        ...session,
        items: [...session.items, { id: nextId(), kind: "meta", text: meta }],
        isRunning: false,
      };
    }

    case "error":
      return {
        ...session,
        items: [...session.items, { id: nextId(), kind: "toolError", text: `エラー: ${ev.message}` }],
        isRunning: false,
      };

    case "session_closed":
      return {
        ...session,
        items: [...session.items, { id: nextId(), kind: "meta", text: "セッション終了" }],
        isRunning: false,
      };
  }
}

export const useChatStore = create<ChatState>((set) => ({
  connected: false,
  sessions: {},
  order: [],
  activeId: null,

  setConnected: (v) => set({ connected: v }),
  setActive: (id) => set({ activeId: id }),

  handleServer: (msg) =>
    set((s) => {
      switch (msg.type) {
        case "state_sync": {
          blockMaps.clear();
          const sessions: Record<string, SessionState> = {};
          const order: string[] = [];
          for (const snap of msg.sessions) {
            const id = snap.meta.sessionId;
            let state: SessionState = {
              meta: snap.meta,
              items: [],
              isRunning: snap.meta.status === "running",
              permission: snap.pendingPermission ?? null,
              question: snap.pendingQuestion ?? null,
            };
            for (const ev of snap.events) state = applyEvent(state, id, ev);
            state.isRunning = snap.meta.status === "running";
            sessions[id] = state;
            order.push(id);
          }
          const activeId =
            s.activeId && sessions[s.activeId] ? s.activeId : (order.at(-1) ?? null);
          return { sessions, order, activeId };
        }

        case "session_created": {
          const id = msg.meta.sessionId;
          const state: SessionState = {
            meta: msg.meta,
            items: [],
            isRunning: false,
            permission: null,
            question: null,
          };
          return {
            sessions: { ...s.sessions, [id]: state },
            order: [...s.order, id],
            // ドラフト状態なら作成されたセッションをアクティブに
            activeId: s.activeId ?? id,
          };
        }

        case "session_meta": {
          const id = msg.meta.sessionId;
          const session = s.sessions[id];
          if (!session) return s;
          return {
            sessions: {
              ...s.sessions,
              [id]: { ...session, meta: msg.meta, isRunning: msg.meta.status === "running" },
            },
          };
        }

        case "session_removed": {
          const { [msg.sessionId]: _removed, ...rest } = s.sessions;
          blockMaps.delete(msg.sessionId);
          const order = s.order.filter((id) => id !== msg.sessionId);
          return {
            sessions: rest,
            order,
            activeId: s.activeId === msg.sessionId ? (order.at(-1) ?? null) : s.activeId,
          };
        }

        case "event": {
          const session = s.sessions[msg.sessionId];
          if (!session) return s;
          return {
            sessions: { ...s.sessions, [msg.sessionId]: applyEvent(session, msg.sessionId, msg.event) },
          };
        }

        case "permission_request": {
          const session = s.sessions[msg.sessionId];
          if (!session) return s;
          return {
            sessions: {
              ...s.sessions,
              [msg.sessionId]: {
                ...session,
                permission: { id: msg.id, toolName: msg.toolName, input: msg.input },
              },
            },
          };
        }

        case "permission_cancelled": {
          const session = s.sessions[msg.sessionId];
          if (!session || session.permission?.id !== msg.id) return s;
          return {
            sessions: { ...s.sessions, [msg.sessionId]: { ...session, permission: null } },
          };
        }

        case "question_request": {
          const session = s.sessions[msg.sessionId];
          if (!session) return s;
          return {
            sessions: {
              ...s.sessions,
              [msg.sessionId]: { ...session, question: { id: msg.id, questions: msg.questions } },
            },
          };
        }

        case "question_cancelled": {
          const session = s.sessions[msg.sessionId];
          if (!session || session.question?.id !== msg.id) return s;
          return {
            sessions: { ...s.sessions, [msg.sessionId]: { ...session, question: null } },
          };
        }

        default:
          return s;
      }
    }),
}));

// アクティブセッションの状態を取り出すセレクタ
export const useActiveSession = (): SessionState | null =>
  useChatStore((s) => (s.activeId ? (s.sessions[s.activeId] ?? null) : null));
