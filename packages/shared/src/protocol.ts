import { z } from "zod";

// ---------- クライアント → サーバー ----------

export const permissionModeSchema = z.enum(["default", "acceptEdits", "plan"]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user_message"),
    text: z.string().min(1),
    cwd: z.string().optional(),
    permissionMode: permissionModeSchema.optional(),
  }),
  z.object({
    type: z.literal("permission_response"),
    id: z.string(),
    behavior: z.enum(["allow", "deny"]),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("interrupt"),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------- サーバー → クライアント ----------

export type ContentBlockInfo =
  | { type: "text" }
  | { type: "thinking" }
  | { type: "tool_use"; name: string };

export type ServerMessage =
  | { type: "init"; sessionId: string; model: string; cwd: string }
  | { type: "block_start"; index: number; block: ContentBlockInfo }
  | { type: "text_delta"; index: number; text: string }
  | { type: "thinking_delta"; index: number; text: string }
  | { type: "tool_input_delta"; index: number; partial: string }
  | { type: "block_stop"; index: number }
  | { type: "permission_request"; id: string; toolName: string; input: unknown }
  | { type: "permission_cancelled"; id: string }
  | { type: "tool_error"; text: string }
  | {
      type: "result";
      subtype: string;
      costUsd: number;
      numTurns: number;
      durationMs: number;
    }
  | { type: "error"; message: string }
  | { type: "session_closed" };
