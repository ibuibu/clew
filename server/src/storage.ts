import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionEvent, SessionGroup, SessionMeta } from "@clew/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = path.join(__dirname, "..", "data", "clew.db");

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

  constructor(file = process.env.CLEW_DB || DEFAULT_DB) {
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL
      )
    `);
    // セッションから外しても候補として残すため、タグ名だけを別に持つ
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        name TEXT PRIMARY KEY
      )
    `);
    // 定型文。テーブルを作った時点でのみ既定値を入れる（全部消したら空のまま）
    const hadQuickReplies = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'quick_replies'")
      .get();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quick_replies (
        text TEXT PRIMARY KEY,
        position INTEGER NOT NULL
      )
    `);
    if (!hadQuickReplies) {
      const insert = this.db.prepare("INSERT INTO quick_replies (text, position) VALUES (?, ?)");
      ["どうした？", "続けて", "yes"].forEach((text, i) => insert.run(text, i));
    }
    // サイドバーの並び順。ドラッグで入れ替えた結果を覚える
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_order (
        session_id TEXT PRIMARY KEY,
        position INTEGER NOT NULL
      )
    `);
    // 既存DBへのカラム追加（初期スキーマからの移行）
    try {
      this.db.exec("ALTER TABLE sessions ADD COLUMN model_pref TEXT");
    } catch {
      /* すでに存在する */
    }
  }

  loadGroups(): SessionGroup[] {
    return this.db
      .prepare("SELECT id, name FROM groups ORDER BY position ASC")
      .all() as SessionGroup[];
  }

  saveGroups(groups: SessionGroup[]) {
    const replace = this.db.transaction((list: SessionGroup[]) => {
      this.db.prepare("DELETE FROM groups").run();
      const insert = this.db.prepare("INSERT INTO groups (id, name, position) VALUES (?, ?, ?)");
      list.forEach((group, index) => insert.run(group.id, group.name, index));
    });
    replace(groups);
  }

  loadTags(): string[] {
    const rows = this.db.prepare("SELECT name FROM tags ORDER BY name ASC").all() as {
      name: string;
    }[];
    return rows.map((r) => r.name);
  }

  saveTags(tags: string[]) {
    const replace = this.db.transaction((list: string[]) => {
      this.db.prepare("DELETE FROM tags").run();
      const insert = this.db.prepare("INSERT INTO tags (name) VALUES (?)");
      for (const name of list) insert.run(name);
    });
    replace(tags);
  }

  loadQuickReplies(): string[] {
    const rows = this.db
      .prepare("SELECT text FROM quick_replies ORDER BY position ASC")
      .all() as { text: string }[];
    return rows.map((r) => r.text);
  }

  saveQuickReplies(items: string[]) {
    const replace = this.db.transaction((list: string[]) => {
      this.db.prepare("DELETE FROM quick_replies").run();
      const insert = this.db.prepare("INSERT INTO quick_replies (text, position) VALUES (?, ?)");
      list.forEach((text, index) => insert.run(text, index));
    });
    replace(items);
  }

  loadOrder(): string[] {
    const rows = this.db
      .prepare("SELECT session_id FROM session_order ORDER BY position ASC")
      .all() as { session_id: string }[];
    return rows.map((r) => r.session_id);
  }

  saveOrder(order: string[]) {
    const replace = this.db.transaction((ids: string[]) => {
      this.db.prepare("DELETE FROM session_order").run();
      const insert = this.db.prepare(
        "INSERT INTO session_order (session_id, position) VALUES (?, ?)",
      );
      ids.forEach((id, index) => insert.run(id, index));
    });
    replace(order);
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
