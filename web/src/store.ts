import { create } from "zustand";
import type {
  QuestionInfo,
  ServerMessage,
  SessionEvent,
  SessionMeta,
} from "@clew/shared";

export type ToolCall = { id: string; name: string; inputJson: string; done: boolean };

export type ChatItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "thinking"; text: string }
  // 連続するツール呼び出しは1つにまとめてスレッドが伸びるのを防ぐ
  | { id: string; kind: "toolGroup"; calls: ToolCall[] }
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
  // 入力欄の書きかけ。キーはセッションid、"" は未作成セッション用
  drafts: Record<string, string>;

  setConnected: (v: boolean) => void;
  setActive: (id: string | null) => void;
  setDraft: (key: string, text: string) => void;
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

function updateToolCall(
  items: ChatItem[],
  callId: string,
  patch: (call: ToolCall) => ToolCall,
): ChatItem[] {
  return items.map((item) =>
    item.kind === "toolGroup" && item.calls.some((c) => c.id === callId)
      ? { ...item, calls: item.calls.map((c) => (c.id === callId ? patch(c) : c)) }
      : item,
  );
}

// 直前のツールグループの位置。thinkingは区切りとみなさず、同じターンのツールを1つにまとめる
function lastToolGroupIndex(items: ChatItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "toolGroup") return i;
    if (items[i].kind !== "thinking") return -1;
  }
  return -1;
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
      if (ev.block.type !== "tool_use") {
        return { ...session, items: [...session.items, { id, kind: ev.block.type, text: "" }] };
      }
      const call: ToolCall = { id, name: ev.block.name, inputJson: "", done: false };
      const groupIndex = lastToolGroupIndex(session.items);
      const items: ChatItem[] =
        groupIndex >= 0
          ? session.items.map((item, i) =>
              i === groupIndex && item.kind === "toolGroup"
                ? { ...item, calls: [...item.calls, call] }
                : item,
            )
          : [...session.items, { id: nextId(), kind: "toolGroup", calls: [call] }];
      return { ...session, items };
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
        items: updateToolCall(session.items, id, (call) => ({
          ...call,
          inputJson: call.inputJson + ev.partial,
        })),
      };
    }

    case "block_stop": {
      const id = blocks.get(ev.index);
      blocks.delete(ev.index);
      if (!id) return session;
      return {
        ...session,
        items: updateToolCall(session.items, id, (call) => ({ ...call, done: true })),
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
  drafts: {},

  setConnected: (v) => set({ connected: v }),
  setActive: (id) => set({ activeId: id }),
  setDraft: (key, text) => set((s) => ({ drafts: { ...s.drafts, [key]: text } })),

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
          const { [msg.sessionId]: _draft, ...drafts } = s.drafts;
          blockMaps.delete(msg.sessionId);
          const order = s.order.filter((id) => id !== msg.sessionId);
          return {
            sessions: rest,
            drafts,
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
