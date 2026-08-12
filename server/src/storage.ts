import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionEvent, SessionMeta } from "@claude-web/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = path.join(__dirname, "..", "data", "claude-web.db");

export type PersistedSession = {
  meta: SessionMeta;
  history: SessionEvent[];
  // Agent SDK側のセッションID（~/.claude/projects のjsonl）。resumeに使う
  sdkSessionId: string | null;
  // ユーザーが選んだモデル（null = Claude Codeの設定に従う）。resume時に引き継ぐ
  modelPref: string | null;
};

export class Storage {
  private db: Database.Database;

  constructor(file = process.env.CLAUDE_WEB_DB || DEFAULT_DB) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        meta TEXT NOT NULL,
        history TEXT NOT NULL,
        sdk_session_id TEXT,
        model_pref TEXT,
        updated_at INTEGER NOT NULL
      )
    `);
    // 既存DBへのカラム追加（初期スキーマからの移行）
    try {
      this.db.exec("ALTER TABLE sessions ADD COLUMN model_pref TEXT");
    } catch {
      /* すでに存在する */
    }
  }

  loadAll(): PersistedSession[] {
    const rows = this.db
      .prepare(
        "SELECT meta, history, sdk_session_id, model_pref FROM sessions ORDER BY updated_at ASC",
      )
      .all() as {
      meta: string;
      history: string;
      sdk_session_id: string | null;
      model_pref: string | null;
    }[];
    return rows.map((row) => ({
      meta: JSON.parse(row.meta) as SessionMeta,
      history: JSON.parse(row.history) as SessionEvent[],
      sdkSessionId: row.sdk_session_id,
      modelPref: row.model_pref,
    }));
  }

  save(s: PersistedSession) {
    this.db
      .prepare(`
        INSERT INTO sessions (id, meta, history, sdk_session_id, model_pref, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          meta = excluded.meta,
          history = excluded.history,
          sdk_session_id = excluded.sdk_session_id,
          model_pref = excluded.model_pref,
          updated_at = excluded.updated_at
      `)
      .run(
        s.meta.sessionId,
        JSON.stringify(s.meta),
        JSON.stringify(s.history),
        s.sdkSessionId,
        s.modelPref,
        Date.now(),
      );
  }

  delete(sessionId: string) {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }
}
