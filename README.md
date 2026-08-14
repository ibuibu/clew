# clew

Claude Code を自作のWebインターフェースから操作するアプリ。
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk)（Claude Codeのハーネスをライブラリ化したもの）をNodeサーバーで動かし、ブラウザとWebSocketでつなぐ。

## 構成

pnpm workspaces のモノレポ。TypeScript全面。

```
packages/shared/   WSメッセージプロトコルの型定義（zodスキーマ）。サーバー/フロントで共有
server/            Hono + ws + Claude Agent SDK。query()をstreaming inputモードで実行
web/               Vite + React + zustand + Tailwind CSS
```

## 起動

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

認証はローカルのClaude Codeログイン情報、または `ANTHROPIC_API_KEY` 環境変数を使う。

## 機能

- 複数セッションの管理（サイドバーで一覧・切り替え・削除、並行実行可）
- セッションの永続化: 履歴はSQLite（`server/data/clew.db`）に保存され、**サーバーを再起動しても復元される**。会話コンテキストはAgent SDKの `resume` でClaude Code側のセッションファイルから復元
- テキストのストリーミング表示（Markdownレンダリング、thinking表示）
- ツール使用の表示（連続する呼び出しは1つにまとまり、クリックで全件と入力JSONを展開）
- 権限確認（ファイル編集やBashの実行前にブラウザで許可/拒否）
- AskUserQuestion専用の質問UI（選択肢・複数選択・自由記述）
- 権限確認と質問は会話ペイン内に表示されるため、応答待ちの間も他のセッションを操作できる
- 入力欄の書きかけの内容はセッションごとに保持される
- ダーク/ライト/システムのテーマ切り替え（デフォルトはシステム設定に追従）
- セッション設定は入力欄の上にタグとして表示（作業ディレクトリ・permission mode・モデル・コスト）。
  作業ディレクトリとpermission modeは新規セッション作成時のみ設定でき、モデルは途中でも切り替えられる
- モデル一覧はClaude Code本体（SDKの `supportedModels()`）から取得するので、選べるモデルが増えれば自動で反映される
- 入力欄で `/` を打つとスラッシュコマンド（skill含む）の候補が出る。一覧はSDKの `supportedCommands()` から取得し、project skills（`<cwd>/.claude/skills`）を含むため作業ディレクトリごとにキャッシュする。↑↓で選択、Enter/Tabで確定、Escで閉じる
- 作業ディレクトリはghqリポジトリ一覧（`GHQ_ROOT`、デフォルト `~/ghq`）と、gwq管理のworktree一覧（`gwq list -g --json`）から選択
- 実行の中断ボタン、ターンごとのコスト・累計コスト表示

## 仕組み

1. サーバーは `SessionManager` がセッションをWS接続から独立して保持する。各セッションは Agent SDK の `query()`（streaming inputモード）+ イベント履歴
2. ブラウザは接続時に `state_sync` で全セッションの履歴を受け取って復元し、以降のイベントはセッションIDタグ付きのブロードキャストで受信する
3. `sessionId` なしの `user_message` で新規セッションを作成（サイドバーの「新規セッション」はドラフト状態にするだけ）
4. `canUseTool` コールバックで権限確認・AskUserQuestionをブラウザへ転送し、レスポンスをPromiseで待つ
5. セッションはブラウザを閉じても生き続け、サイドバーの✕で明示的に削除する。meta・履歴・Agent SDKのセッションIDはターン完了ごとにSQLiteへ保存され、サーバー再起動後の最初のメッセージ送信時に `resume` でClaude Code側の会話コンテキストごと復元される（DBパスは `CLEW_DB` で変更可）

WSメッセージの型は `packages/shared/src/protocol.ts` に集約している。プロトコルを変えるときはここを起点に修正する。
