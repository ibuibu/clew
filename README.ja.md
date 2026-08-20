# 🧵 clew

**Claude Code と Codex を操作するセルフホストのWeb UI。**

[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk)（Claude Codeのハーネスをライブラリ化したもの）と `codex app-server` をNodeサーバーで動かし、ブラウザとWebSocketでつなぐ。複数セッション、ストリーミング表示、権限確認をひとつのWebインターフェースで。

[English](./README.md)

## ✨ 機能

- **2つのエージェントを同じUIで** — セッション作成時にClaudeかCodexを選ぶ。ストリーミング表示・権限確認・質問UI・中断・モデル切り替え・resumeはどちらでも同じように動く
- **複数セッションの管理** — サイドバーで一覧・切り替え・削除、並行実行可。新規セッションは `Cmd/Ctrl+Shift+O` でも開始できる
- **セッションの永続化** — 履歴はSQLite（`server/data/clew.db`）に保存され、サーバーを再起動しても復元される。会話コンテキストはエージェント側のセッションファイルから復元する（Agent SDKの `resume`、または `thread/resume`）
- **ストリーミング表示** — Markdownレンダリング、thinking表示
- **ツール使用の表示** — 連続する呼び出しは1つにまとまり、クリックで全件と入力JSONを展開
- **権限確認** — ファイル編集やBashの実行前にブラウザで許可/拒否
- **質問専用UI** — Claudeの `AskUserQuestion` とCodexの `request_user_input` に対応。選択肢・複数選択・自由記述（`Cmd/Ctrl+Enter` で回答）
- **応答待ちでブロックしない** — 権限確認と質問は会話ペイン内に表示されるため、応答待ちの間も他のセッションを操作できる
- **セッションごとの下書き保持** — 入力欄の書きかけの内容はセッションごとに保持される
- **ダーク/ライト/システムのテーマ切り替え**（デフォルトはシステム設定に追従）
- **セッション設定をタグ表示** — 入力欄の上に作業ディレクトリ・permission mode・モデル・コストを表示。作業ディレクトリとpermission modeは新規セッション作成時のみ設定でき、モデルは途中でも切り替えられる
- **モデル一覧の自動取得** — エージェント本体（`supportedModels()` / `model/list`）から取得するので、選べるモデルが増えれば自動で反映される
- **スラッシュコマンド補完** — 入力欄で `/` を打つとスラッシュコマンド（skill含む）の候補が出る。一覧は `supportedCommands()` / `skills/list` から取得し、project skills（`<cwd>/.claude/skills`）を含むためエージェントと作業ディレクトリごとにキャッシュする。↑↓で選択、Enter/Tabで確定、Escで閉じる
- **リポジトリから作業ディレクトリを選択** — ghqリポジトリ一覧（`GHQ_ROOT`、デフォルト `~/ghq`）と、gwq管理のworktree一覧（`gwq list -g --json`）から選択
- **実行の中断ボタン**、ターンごとのコスト・累計コスト表示（Codexは金額を返さないのでトークン数を表示）

## 🚀 起動

```bash
pnpm install

# 開発（サーバー :3456 + Vite dev server :5173 を同時起動）
pnpm dev
# → http://localhost:5173

# 本番（webをビルドしてサーバーから配信）
pnpm build
pnpm start
# → http://localhost:3456
```

認証はローカルのClaude Codeログイン情報、または `ANTHROPIC_API_KEY` 環境変数を使う。Codexセッションを使うには `codex` コマンドがPATHにあり、`codex login` が済んでいること（バイナリは `CLEW_CODEX_BIN` で差し替えられる）。

## 🏗️ 構成

pnpm workspaces のモノレポ。TypeScript全面。

```
packages/shared/   WSメッセージプロトコルの型定義（zodスキーマ）。サーバー/フロントで共有
server/            Hono + ws。Claude Agent SDKの query() と codex app-server を同じ形にして扱う
web/               Vite + React + zustand + Tailwind CSS
```

どちらのエージェントも `AgentBackend`（`server/src/agents/types.ts`）を実装しているため、`SessionManager` から下とWeb側はエージェントを意識しない。

- `server/src/agents/claude.ts` — Agent SDKの `query()` をstreaming inputモードで実行
- `server/src/agents/codex/` — `codex app-server` を1プロセスだけ持ち（stdio上のJSON-RPC）、セッションごとに1スレッドを割り当てる

### 仕組み

1. サーバーは `SessionManager` がセッションをWS接続から独立して保持する。各セッションはエージェント1つ + イベント履歴
2. ブラウザは接続時に `state_sync` で全セッションの履歴を受け取って復元し、以降のイベントはセッションIDタグ付きのブロードキャストで受信する
3. `sessionId` なしの `user_message` で新規セッションを作成（サイドバーの「新規セッション」はドラフト状態にするだけ）
4. 権限確認と質問はブラウザへ転送し、レスポンスをPromiseで待つ。Claudeは `canUseTool`、Codexはapp-serverの承認リクエストと `request_user_input` を使う
5. セッションはブラウザを閉じても生き続け、サイドバーの✕で明示的に削除する。meta・履歴・エージェント側のセッションIDはターン完了ごとにSQLiteへ保存され、サーバー再起動後の最初のメッセージ送信時にエージェントの会話コンテキストごと復元される（DBパスは `CLEW_DB` で変更可）

Codexについての注意: app-serverのプロトコルはexperimental扱いで、Codexのバージョンが上がると形が変わりうる。`server/src/agents/codex/protocol.ts` にはclewが使う部分だけを書いてあり、全体は `codex app-server generate-ts` で出せる。Codexは金額を返さないのでトークン数を表示する。permission modeは `approvalPolicy` と `sandbox` の組み合わせで、Claudeとは別の一覧を入力欄の上に出す。

WSメッセージの型は `packages/shared/src/protocol.ts` に集約している。プロトコルを変えるときはここを起点に修正する。
