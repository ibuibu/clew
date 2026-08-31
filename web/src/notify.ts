import { create } from "zustand";
import type { AgentUsage } from "@clew/shared";
import { AGENT_LABEL } from "./format";
import { useChatStore, type SessionState } from "./store";
import { ALERT_PERCENT, alertKey, usageAlerts } from "./usage-alert";

const STORAGE_KEY = "clew-notify";
const supported = "Notification" in window;

interface NotifyState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
}

export const useNotifyStore = create<NotifyState>((set) => ({
  enabled:
    supported && Notification.permission === "granted" && localStorage.getItem(STORAGE_KEY) !== "off",

  setEnabled: async (enabled) => {
    if (!enabled) {
      localStorage.setItem(STORAGE_KEY, "off");
      set({ enabled: false });
      return;
    }
    // 許可ダイアログはユーザー操作から呼ばないとブラウザに無視される
    const permission = supported ? await Notification.requestPermission() : "denied";
    if (permission !== "granted") return;
    localStorage.setItem(STORAGE_KEY, "on");
    set({ enabled: true });
  },
}));

export const notifySupported = supported;

type Snapshot = { isRunning: boolean; permissionId: string | null; questionId: string | null };

const snapshot = (session: SessionState): Snapshot => ({
  isRunning: session.isRunning,
  permissionId: session.permission?.id ?? null,
  questionId: session.question?.id ?? null,
});

function lastResult(session: SessionState): string {
  const last = session.items.at(-1);
  return last && (last.kind === "meta" || last.kind === "toolError") ? last.text : "完了";
}

// 承認・質問はユーザーを待たせている状態なので、完了より優先して知らせる
function describe(before: Snapshot, session: SessionState): string | null {
  if (session.permission && before.permissionId !== session.permission.id) {
    return `承認待ち: ${session.permission.toolName}`;
  }
  if (session.question && before.questionId !== session.question.id) {
    return `質問: ${session.question.questions[0]?.question ?? ""}`;
  }
  if (before.isRunning && !session.isRunning) return lastResult(session);
  return null;
}

function show(sessionId: string, session: SessionState, body: string) {
  // tag をセッションidにすると、同じセッションの通知は積み上がらず置き換わる
  const notification = new Notification(session.meta.title || "（無題）", {
    body,
    tag: sessionId,
    icon: "/favicon.svg",
  });
  notification.onclick = () => {
    window.focus();
    useChatStore.getState().setActive(sessionId);
    notification.close();
  };
}

let previous = new Map<string, Snapshot>();
// 通知済みのウィンドウ。枠がリセットされるまで繰り返し知らせない
const notifiedUsage = new Set<string>();

function notifyUsage(usage: AgentUsage[] | null): void {
  for (const alert of usageAlerts(usage)) {
    const key = alertKey(alert);
    if (notifiedUsage.has(key)) continue;
    notifiedUsage.add(key);
    new Notification("利用量の警告", {
      body: `${AGENT_LABEL[alert.agent]} ${alert.window.label} が ${alert.window.usedPercent}%（${ALERT_PERCENT}%超）`,
      tag: key,
      icon: "/favicon.svg",
    });
  }
}

export function initNotify() {
  if (!supported) return;

  useChatStore.subscribe((state) => {
    // 利用量の警告は画面を見ていても気づけるようフォーカスに関係なく出す
    if (useNotifyStore.getState().enabled) notifyUsage(state.usage);

    const current = new Map<string, Snapshot>();
    // hidden はタブ切替・最小化のみ。別モニタ等で見えたままフォーカスが外れた場合は hasFocus で拾う
    const notifiable =
      useNotifyStore.getState().enabled && (document.hidden || !document.hasFocus());

    for (const [id, session] of Object.entries(state.sessions)) {
      current.set(id, snapshot(session));
      const before = previous.get(id);
      // 初回同期や再接続直後の state_sync は既存の状態なので通知しない
      if (!before || !notifiable) continue;
      const body = describe(before, session);
      if (body) show(id, session, body);
    }
    previous = current;
  });
}
