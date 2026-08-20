import type { SessionMode, SessionOutput } from "@clew/shared";
import type { ImageMediaType } from "../uploads.js";

// 添付画像。Claudeはbase64で、Codexはファイルパスで受け取るため両方を引ける形で渡す
export type Attachment = { url: string; path: string; mediaType: ImageMediaType };

export type AgentOptions = {
  cwd: string;
  mode: SessionMode;
  // エージェント側のセッションID。あれば会話を復元する
  resume?: string;
  model?: string;
};

// clewが1セッションを動かすために必要な操作。ClaudeとCodexで同じ形にする
export interface AgentBackend {
  pushUserMessage(text: string, images: Attachment[]): void;
  resolvePermission(id: string, behavior: "allow" | "deny", message?: string): void;
  resolveQuestion(id: string, answers?: Record<string, string>): void;
  interrupt(): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMode(mode: SessionMode): Promise<void>;
  dispose(): void;
}

export type AgentSend = (out: SessionOutput) => void;
