import type { AgentKind, SessionMode } from "@clew/shared";

// 新規セッション作成時の設定。ドラフト状態でのみ編集でき、次回起動にも引き継ぐ
export const cwdRef = { current: localStorage.getItem("clew-cwd") || "" };
export const agentRef = { current: (localStorage.getItem("clew-agent") || "claude") as AgentKind };
export const permModeRef = {
  current: (localStorage.getItem("clew-perm") || "auto") as SessionMode,
};
export const modelRef = { current: localStorage.getItem("clew-model") || "" };
export const effortRef = { current: localStorage.getItem("clew-effort") || "" };
