// Platform control-plane store (SQLite, built into Node). Separate from any monitored database.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Row = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, engine TEXT NOT NULL,
  host TEXT NOT NULL, port INTEGER NOT NULL, database TEXT NOT NULL,
  ro_user TEXT NOT NULL, ro_secret_ref TEXT NOT NULL,
  exec_user TEXT NOT NULL, exec_secret_ref TEXT NOT NULL,
  autonomy_level INTEGER NOT NULL DEFAULT 2,
  server_version TEXT, permission_report TEXT, validated_at TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES targets(id),
  status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
  requested_by TEXT NOT NULL, collector_runs TEXT, score TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL REFERENCES assessments(id),
  collector TEXT NOT NULL, source TEXT NOT NULL, data TEXT NOT NULL, collected_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL REFERENCES assessments(id),
  rule_id TEXT NOT NULL, dimension TEXT NOT NULL, severity TEXT NOT NULL,
  title TEXT NOT NULL, detail TEXT NOT NULL, object TEXT,
  evidence_ids TEXT NOT NULL, facts TEXT NOT NULL, candidate_actions TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL REFERENCES assessments(id),
  mode TEXT NOT NULL, model TEXT, output TEXT, grounded INTEGER NOT NULL,
  rejected_reason TEXT, input_tokens INTEGER, output_tokens INTEGER,
  latency_ms INTEGER, cost_usd REAL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS change_plans (
  id TEXT PRIMARY KEY, number INTEGER NOT NULL, target_id TEXT NOT NULL REFERENCES targets(id),
  assessment_id TEXT, finding_id TEXT, analysis_id TEXT,
  action_id TEXT NOT NULL, params TEXT NOT NULL, risk TEXT NOT NULL,
  rationale TEXT, policy TEXT NOT NULL, plan TEXT NOT NULL,
  preconditions TEXT, fingerprint TEXT, status TEXT NOT NULL,
  requested_by TEXT NOT NULL, created_at TEXT NOT NULL,
  decided_by TEXT, decided_at TEXT, decision_note TEXT, expires_at TEXT,
  executed_at TEXT, baseline TEXT, after TEXT, verification TEXT, result TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS change_locks (
  target_id TEXT PRIMARY KEY, change_id TEXT NOT NULL, acquired_at TEXT NOT NULL, holder TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, channel TEXT NOT NULL, severity TEXT NOT NULL,
  subject TEXT NOT NULL, body TEXT NOT NULL, delivery TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, ts TEXT NOT NULL,
  actor TEXT NOT NULL, event_type TEXT NOT NULL, target TEXT, change_id TEXT,
  payload TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
-- Append-only audit: the store itself refuses UPDATE and DELETE.
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
`;

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.db.exec(SCHEMA);
  }

  all(sql: string, ...params: unknown[]): Row[] {
    return this.db.prepare(sql).all(...(params as never[])) as Row[];
  }

  get(sql: string, ...params: unknown[]): Row | undefined {
    return this.db.prepare(sql).get(...(params as never[])) as Row | undefined;
  }

  run(sql: string, ...params: unknown[]): { changes: number } {
    const r = this.db.prepare(sql).run(...(params as never[]));
    return { changes: Number(r.changes) };
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  getSetting(key: string): string | undefined {
    return this.get('SELECT value FROM settings WHERE key = ?', key)?.value as string | undefined;
  }

  setSetting(key: string, value: string): void {
    this.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }
}

// JSON column helpers.
export const j = (v: unknown): string => JSON.stringify(v ?? null);
export const pj = <T = unknown>(v: unknown): T => (v == null ? (null as T) : (JSON.parse(String(v)) as T));
