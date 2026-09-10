# AGENTS.md

clew は Claude Code / Codex をブラウザから使うためのセルフホスト Web UI。
pnpm workspaces のモノレポで、全体 TypeScript。

## 構成

```
packages/shared/   WS メッセージのプロトコル型（zod スキーマ）。server と web で共有
server/            Hono + ws。Claude Agent SDK の query() と codex app-server を AgentBackend で抽象化
web/               Vite + React + zustand + Tailwind CSS
```

- 両エージェントは `server/src/agents/types.ts` の `AgentBackend` を実装する。`SessionManager` と web 側はエージェント非依存に保つ
- プロトコルを変更するときは `packages/shared/src/protocol.ts` から入る。server / web の両方に影響する
- セッションの永続化は SQLite（`server/data/clew.db`、`CLEW_DB` で変更可）

## コマンド

```bash
pnpm install
pnpm dev        # server :3456 + Vite dev server :5173
pnpm build      # web をビルド
pnpm start      # server から web を配信（:3456）
pnpm typecheck  # 全パッケージの tsc --noEmit
```

lint / formatter は入っていない。変更後は `pnpm typecheck` を通す。

## 公開リポジトリなので固有名詞を書かない

このリポジトリは公開されている。コード・コメント・ドキュメント・コミットメッセージ・PR の説明のいずれにも、勤務先・社内製品・社内リポジトリなどの固有名詞を書かない。

- 実在の組織名や社内サービス名をサンプルデータやテストの値に使わない
- 動作確認で使った社内リポジトリのパスをそのまま残さない。`~/ghq/github.com/<user>/<repo>` のような一般化した形にする
- 個人情報（メールアドレス、実名、社内 URL、Slack チャンネル名など）も同様に書かない

固有名詞が必要になる場合は環境変数か設定ファイルに追い出し、リポジトリには変数名だけを置く。

## ドキュメント

README.md（英語）と README.ja.md（日本語）は同じ内容を保つ。片方だけ更新しない。
