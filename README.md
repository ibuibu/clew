# claude-web

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

- テキストのストリーミング表示（Markdownレンダリング、thinking表示）
- ツール使用の表示（ツール名 + 入力JSON、クリックで展開）
- 権限確認モーダル（ファイル編集やBashの実行前にブラウザで許可/拒否）
- permission mode切り替え（default / acceptEdits / plan）
- 作業ディレクトリの指定（ヘッダーの入力欄、localStorageに保存）
- 実行の中断ボタン
- ターンごとのコスト・累計コスト表示

## 仕組み

1. ブラウザがWebSocketで接続し、`user_message` を送る
2. サーバーは初回メッセージで Agent SDK の `query()` を streaming input モードで開始（1接続 = 1セッション、会話は継続する）
3. `includePartialMessages: true` で受け取ったstream eventを `ServerMessage` に整形してブラウザへ中継
4. `canUseTool` コールバックで権限確認をブラウザへ転送し、レスポンスをPromiseで待つ
5. WebSocket切断時はセッションをinterruptしてクリーンアップ

WSメッセージの型は `packages/shared/src/protocol.ts` に集約している。プロトコルを変えるときはここを起点に修正する。
