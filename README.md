# 🧵 clew

**A self-hosted web UI for Claude Code.**

clew runs the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) — Claude Code's harness as a library — on a Node server and connects it to your browser over WebSocket. Multiple sessions, streaming output, permission prompts, all in a clean web interface.

[日本語](./README.ja.md)

## ✨ Features

- **Multi-session** — list, switch, and delete sessions from the sidebar; run them in parallel. Start a new session with `Cmd/Ctrl+Shift+O`
- **Persistent sessions** — history is stored in SQLite (`server/data/clew.db`) and survives server restarts. Conversation context is restored from Claude Code's session files via the Agent SDK's `resume`
- **Streaming output** — Markdown rendering with thinking display
- **Tool use display** — consecutive calls collapse into one row; click to expand all calls and their input JSON
- **Permission prompts** — approve or deny file edits and Bash commands from the browser
- **Dedicated question UI** for `AskUserQuestion` — options, multi-select, free text (submit with `Cmd/Ctrl+Enter`)
- **Non-blocking prompts** — permission and question prompts render inside the conversation pane, so you can work in other sessions while one waits for input
- **Per-session drafts** — unsent input is kept per session
- **Dark / light / system theme** (follows system by default)
- **Session settings as tags** above the composer (working directory, permission mode, model, cost). Working directory and permission mode are set at session creation; the model can be switched mid-session
- **Auto-discovered models** — the model list comes from Claude Code itself (`supportedModels()`), so new models show up automatically
- **Slash command completion** — type `/` to get suggestions (skills included) from `supportedCommands()`, cached per working directory since it includes project skills (`<cwd>/.claude/skills`). Navigate with ↑↓, confirm with Enter/Tab, dismiss with Esc
- **Repo-aware working directory picker** — choose from ghq repositories (`GHQ_ROOT`, default `~/ghq`) and gwq-managed worktrees (`gwq list -g --json`)
- **Interrupt button**, plus per-turn and cumulative cost display

## 🚀 Getting Started

```bash
pnpm install

# Development (server on :3456 + Vite dev server on :5173)
pnpm dev
# → http://localhost:5173

# Production (build web and serve it from the server)
pnpm build
pnpm start
# → http://localhost:3456
```

Authentication uses your local Claude Code login, or the `ANTHROPIC_API_KEY` environment variable.

## 🏗️ Architecture

A pnpm workspaces monorepo, TypeScript throughout.

```
packages/shared/   WS message protocol types (zod schemas), shared by server and web
server/            Hono + ws + Claude Agent SDK. Runs query() in streaming input mode
web/               Vite + React + zustand + Tailwind CSS
```

### How it works

1. On the server, `SessionManager` holds sessions independently of WS connections. Each session is an Agent SDK `query()` (streaming input mode) plus an event history
2. On connect, the browser receives the full history of every session via `state_sync`, then gets subsequent events as broadcasts tagged with a session ID
3. A `user_message` without a `sessionId` creates a new session (the sidebar's "new session" button only enters a draft state)
4. The `canUseTool` callback forwards permission prompts and `AskUserQuestion` to the browser and awaits the response as a Promise
5. Sessions stay alive after the browser closes; delete them explicitly with ✕ in the sidebar. Meta, history, and the Agent SDK session ID are saved to SQLite after each turn, and after a server restart the first message `resume`s the session — Claude Code's conversation context included (DB path configurable via `CLEW_DB`)

WS message types live in `packages/shared/src/protocol.ts` — start there when changing the protocol.
