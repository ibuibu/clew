# 🧵 clew

**A self-hosted web UI for Claude Code and Codex.**

clew runs the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) — Claude Code's harness as a library — and `codex app-server` on a Node server, and connects them to your browser over WebSocket. Multiple sessions, streaming output, permission prompts, all in a clean web interface.

[日本語](./README.ja.md)

## ✨ Features

- **Two agents, one UI** — pick Claude or Codex when you create a session. Streaming, permission prompts, the question UI, interrupt, model switching, and resume all work the same either way
- **Multi-session** — list, switch, and delete sessions from the sidebar; run them in parallel. Start a new session with `Cmd/Ctrl+Shift+O`
- **Persistent sessions** — history is stored in SQLite (`server/data/clew.db`) and survives server restarts. Conversation context is restored from the agent's own session files (the Agent SDK's `resume`, or `thread/resume`)
- **Streaming output** — Markdown rendering with thinking display
- **Tool use display** — consecutive calls collapse into one row; click to expand all calls and their input JSON
- **Permission prompts** — approve or deny file edits and Bash commands from the browser
- **Auto-approval for Codex** — the `auto` mode routes approval decisions to a Codex subagent that judges each request by risk instead of interrupting you, the same idea as Claude's `auto` (a model classifier decides). The sandbox stays on, so anything it denies is still blocked and the reason is shown in the conversation
- **Committable workspace for Codex** — `workspace-write` keeps `.git` read-only, which blocks commits, so the repository's git directory is added to the sandbox's writable roots. It is resolved with `--git-common-dir`, so worktrees work too. Add more directories with `CLEW_CODEX_WRITABLE_ROOTS` (`PATH`-style separator) when the work has to write outside the workspace
- **Dedicated question UI** for `AskUserQuestion` (Claude) and `request_user_input` (Codex) — options, multi-select, free text (submit with `Cmd/Ctrl+Enter`)
- **Non-blocking prompts** — permission and question prompts render inside the conversation pane, so you can work in other sessions while one waits for input
- **Per-session drafts** — unsent input is kept per session
- **Dark / light / system theme** (follows system by default)
- **Session settings as tags** above the composer (working directory, permission mode, model, cost). Working directory and permission mode are set at session creation; the model can be switched mid-session
- **Auto-discovered models** — the model list comes from the agent itself (`supportedModels()` / `model/list`), so new models show up automatically
- **Slash command completion** — type `/` to get suggestions (skills included) from `supportedCommands()` / `skills/list`, cached per agent and working directory since it includes project skills (`<cwd>/.claude/skills`). Navigate with ↑↓, confirm with Enter/Tab, dismiss with Esc
- **Repo-aware working directory picker** — choose from ghq repositories (`GHQ_ROOT`, default `~/ghq`)
- **Interrupt button**, plus per-turn and cumulative cost (Claude) or token usage (Codex)
- **Combined rate-limit view** — a meter above the composer opens a popup showing how much of each agent's limits you have burned: Claude's 5-hour and 7-day windows (including per-model ones) and Codex's weekly window, each with utilization and time until it resets
- **Quick replies** — send frequently used messages (a nudge to keep going, for example) from a button; add and remove them inline
- **Sidebar reordering** — drag sessions to reorder them and to move them into the group you drop them on; rename them in place
- **Copy as Markdown** — copy a single message, or the whole conversation with tool calls stripped out
- **Bullet list editing** — lists continue automatically in the composer, and Tab / Shift+Tab change the indent level
- **Session groups and tags** — collapse the sidebar by group and filter by tag; tags you have used stay in the suggestions

## 🚀 Getting Started

```bash
pnpm install

# Development (server on :3456 + Vite dev server on :5173)
pnpm dev
# → http://localhost:5173

# A second instance on other ports, with its own SQLite (useful from a git worktree)
CLEW_SERVER_PORT=3457 CLEW_WEB_PORT=5174 pnpm dev
# → http://localhost:5174

# Production (build web and serve it from the server)
pnpm build
pnpm start
# → http://localhost:3456
```

Authentication uses your local Claude Code login, or the `ANTHROPIC_API_KEY` environment variable. Codex sessions need the `codex` CLI on `PATH` and a finished `codex login` (override the binary with `CLEW_CODEX_BIN`).

## 🏗️ Architecture

A pnpm workspaces monorepo, TypeScript throughout.

```
packages/shared/   WS message protocol types (zod schemas), shared by server and web
server/            Hono + ws. Claude Agent SDK query() and codex app-server behind one interface
web/               Vite + React + zustand + Tailwind CSS
```

Both agents implement `AgentBackend` (`server/src/agents/types.ts`), so `SessionManager` and the whole web UI stay agent-agnostic.

- `server/src/agents/claude.ts` — Agent SDK `query()` in streaming input mode
- `server/src/agents/codex/` — one `codex app-server` process (JSON-RPC over stdio) multiplexing one thread per session

### How it works

1. On the server, `SessionManager` holds sessions independently of WS connections. Each session is one agent backend plus an event history
2. On connect, the browser receives the full history of every session via `state_sync`, then gets subsequent events as broadcasts tagged with a session ID
3. A `user_message` without a `sessionId` creates a new session (the sidebar's "new session" button only enters a draft state)
4. Permission prompts and questions are forwarded to the browser and awaited as a Promise — via `canUseTool` for Claude, and via the app-server's approval / `request_user_input` requests for Codex
5. Sessions stay alive after the browser closes; delete them explicitly with ✕ in the sidebar. Meta, history, and the agent-side session ID are saved to SQLite after each turn, and after a server restart the first message resumes the session — the agent's conversation context included (DB path configurable via `CLEW_DB`)

Codex notes: the app-server protocol is experimental, so its shapes can change between Codex releases — `server/src/agents/codex/protocol.ts` holds only the parts clew uses, and `codex app-server generate-ts` prints the full set. Codex reports token usage instead of a dollar amount. Its permission modes are combinations of `approvalPolicy`, `sandbox`, and `approvalsReviewer`, listed separately from Claude's in the composer. The guardian auto-review payloads are marked unstable, so only denied reviews are surfaced and a shape change degrades to silence rather than an error.

Usage notes: the rate-limit numbers in `server/src/usage.ts` come from the agents themselves — the Agent SDK's structured `/usage` and the app-server's `account/rateLimits/read`. The SDK method is marked experimental and is expected to be renamed when it stabilizes, so failures are caught and shown in the popup instead of breaking it. Reading Claude's usage spawns a throwaway `query()`, which is why the result is cached for a minute.

WS message types live in `packages/shared/src/protocol.ts` — start there when changing the protocol.
