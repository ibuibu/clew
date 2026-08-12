# Claude Agent SDK のメッセージフロー

`query()` が返す AsyncGenerator から流れてくるメッセージ（`SDKMessage`）と、このアプリ（`server.js`）での扱いをまとめる。

型定義の出典: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`

## 全体像

```js
const q = query({ prompt: input.iterate(), options: { ... } });

for await (const message of q) {
  // message.type で分岐して処理する
}
```

ツールを使う1ターンの典型的な流れは次のとおり。

```
system (subtype: init)          … セッション開始時に1回
→ stream_event × N              … テキストやツール引数が少しずつ届く
→ assistant                     … tool_use ブロック入りの完成メッセージ
→ user                          … tool_result（ツールの実行結果）
→ stream_event × N → assistant  … 最終回答
→ result                        … ターン完了（コスト・所要時間など）
```

## 主要なメッセージ

### system (subtype: init)

セッション開始時に1回だけ届く。session_id、model、cwd、使えるツール一覧、MCPサーバーの状態などが入っている。

```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "...",
  "model": "claude-...",
  "cwd": "/path/to/project",
  "tools": ["Bash", "Read", "Edit", "..."],
  "mcp_servers": [{ "name": "...", "status": "..." }]
}
```

server.js では `init` としてクライアントに転送している。

### stream_event

`options.includePartialMessages: true` を指定したときだけ流れる。Anthropic API の生ストリーミングイベント（`BetaRawMessageStreamEvent`）を `event` フィールドに包んだもの。

```json
{
  "type": "stream_event",
  "event": { "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": "こん" } },
  "parent_tool_use_id": null,
  "session_id": "..."
}
```

`event.type` の主なもの:

| event.type | 内容 |
| --- | --- |
| `content_block_start` | ブロック開始。`content_block.type` は `text` / `thinking` / `tool_use` など |
| `content_block_delta` | ブロックの断片。`delta.type` は `text_delta`（本文）/ `thinking_delta`（思考）/ `input_json_delta`（ツール引数JSONの断片） |
| `content_block_stop` | ブロック終了 |

server.js ではこれを `block_start` / `text_delta` / `tool_input_delta` / `thinking_delta` / `block_stop` に変換してクライアントへ送っている。

### assistant

1回のAPI応答が完成するたびに届く、完全なメッセージ。`message.content` にテキストや `tool_use` ブロックの配列が入っている。stream_event で流れた内容の完成版なので、このアプリでは使わず stream_event 側だけ拾っている。

```json
{
  "type": "assistant",
  "message": { "role": "assistant", "content": [{ "type": "tool_use", "name": "Bash", "input": { "command": "ls" } }] },
  "parent_tool_use_id": null,
  "session_id": "..."
}
```

### user

ツールの実行結果。`message.content` に `tool_result` ブロックが入っている。文字列化される前の構造化された結果が `tool_use_result` フィールドに別途付いてくる。

```json
{
  "type": "user",
  "message": { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "...", "is_error": false, "content": "..." }] },
  "tool_use_result": { "...": "ツールごとの構造化データ" }
}
```

server.js では `is_error: true` のものだけ `tool_error` としてクライアントに通知している。

### result

ターン完了時に1回届く。成功とエラーで subtype が分かれる。

- 成功: `subtype: "success"`
- エラー: `subtype: "error_during_execution" | "error_max_turns" | "error_max_budget_usd" | "error_max_structured_output_retries"`

```json
{
  "type": "result",
  "subtype": "success",
  "duration_ms": 12345,
  "num_turns": 3,
  "total_cost_usd": 0.05,
  "usage": { "input_tokens": 1000, "output_tokens": 500 },
  "modelUsage": { "claude-...": { "..." : "モデル別の累計" } }
}
```

注意点:

- streaming input セッションでは `total_cost_usd` と `modelUsage` は累計値。合算せず最新の result の値を読む。
- `usage` はメインループのみの値。サブエージェント等を含むトークン集計には `modelUsage` を使う。

## その他のメッセージ

`SDKMessage` の union には他にも40種類近くの型がある。主なもの:

| type | 内容 |
| --- | --- |
| `system` (subtype: `compact_boundary`) | コンテキスト圧縮が起きた境界。圧縮前後のトークン数が入る |
| `tool_progress` | 実行中ツールの進捗 |
| `hook_started` / `hook_progress` / `hook_response` | フックの実行状況 |
| `task_notification` | バックグラウンドのサブエージェント完了通知 |
| `api_retry` | APIリトライの発生 |

server.js の switch で拾っていない型は単に無視される。

## 入力側（アプリ → SDK）

`query()` の `prompt` に AsyncIterable を渡すと、streaming input モードになりセッションを維持したまま複数ターン送れる。流し込むメッセージの形は次のとおり（server.js の `user_message` ハンドラ参照）。

```js
input.push({
  type: "user",
  message: { role: "user", content: "ユーザーの発言" },
  parent_tool_use_id: null,
});
```

このほか、ツール実行の許可は `options.canUseTool` コールバックで非同期に応答し、中断は `q.interrupt()` で行う。
