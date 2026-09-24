// Oracle connections (node-oracledb thin mode: no Oracle Client needed). Two physically separate pools:
//   ro   -> assessment, monitoring, diagnostics, evidence, preconditions, verification
//   exec -> only executeAuthorized(), called only by the Executor after policy + approval + revalidation
// Oracle has no per-role default read-only transaction, so every RO call runs inside SET TRANSACTION READ ONLY.
import oracledb from 'oracledb';
import type { Target } from '../../core/types.ts';
import { log } from '../../core/util.ts';
import { resolveSecret } from '../postgres/connection.ts';

export type OraRow = Record<string, any>;

export class OraConnections {
  private target: Target;
  private roPool?: oracledb.Pool;
  private execPool?: oracledb.Pool;

  constructor(target: Target) {
    this.target = target;
  }

  get connectString(): string {
    return `${this.target.host}:${this.target.port}/${this.target.database}`;
  }

  private async pool(identity: 'ro' | 'exec'): Promise<oracledb.Pool> {
    const t = this.target;
    const make = (user: string, ref: string, max: number) =>
      oracledb.createPool({ user, password: resolveSecret(ref), connectString: this.connectString, poolMin: 0, poolMax: max, poolIncrement: 1, poolTimeout: 30, queueTimeout: 10_000 });
    if (identity === 'ro') return (this.roPool ??= await make(t.ro_user, t.ro_secret_ref, 2));
    return (this.execPool ??= await make(t.exec_user, t.exec_secret_ref, 1));
  }

  private async tag(c: oracledb.Connection, identity: string) {
    // Visible in V$SESSION.MODULE / ACTION: the platform's own sessions are identifiable and excluded from findings.
    c.module = 'ai-dba-platform';
    c.action = identity;
  }

  // Read-only query: SET TRANSACTION READ ONLY + call timeout. Column names come back upper-case.
  async ro<T = OraRow>(sql: string, binds: oracledb.BindParameters = [], timeoutMs = 5000): Promise<T[]> {
    const c = await (await this.pool('ro')).getConnection();
    let broken = false;
    try {
      await this.tag(c, 'ro');
      c.callTimeout = timeoutMs;
      await c.execute('SET TRANSACTION READ ONLY');
      const r = await c.execute<T>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      await c.commit();
      return (r.rows ?? []) as T[];
    } catch (e) {
      await c.rollback().catch(() => (broken = true));
      throw e;
    } finally {
      await c.close({ drop: broken }).catch(() => {});
    }
  }

  // Runs fn on a dedicated RO connection that is DROPPED afterwards (used when session state is altered,
  // e.g. optimizer_use_pending_statistics for validating pending statistics in isolation).
  async roIsolated<T>(fn: (c: oracledb.Connection) => Promise<T>, timeoutMs: number): Promise<T> {
    const c = await (await this.pool('ro')).getConnection();
    try {
      await this.tag(c, 'ro-isolated');
      c.callTimeout = timeoutMs;
      return await fn(c);
    } finally {
      await c.rollback().catch(() => {});
      await c.close({ drop: true }).catch(() => {});
    }
  }

  async exec(sql: string, callTimeoutMs: number, lockTimeoutMs: number): Promise<{ command: string; ms: number }> {
    const c = await (await this.pool('exec')).getConnection();
    try {
      await this.tag(c, 'exec');
      c.callTimeout = callTimeoutMs;
      await c.execute(`ALTER SESSION SET ddl_lock_timeout = ${Math.max(1, Math.ceil(lockTimeoutMs / 1000))}`);
      const t0 = performance.now();
      await c.execute(sql);
      return { command: 'PL/SQL', ms: Math.round(performance.now() - t0) };
    } finally {
      await c.close({ drop: true }).catch(() => {}); // never return a session with altered state to the pool
    }
  }

  async execIdentityCheck(): Promise<string> {
    const c = await (await this.pool('exec')).getConnection();
    try {
      await this.tag(c, 'exec-login-check');
      const r = await c.execute<{ U: string }>(`SELECT USER AS u FROM dual`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return r.rows![0].U;
    } finally {
      await c.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    await Promise.all([this.roPool?.close(0), this.execPool?.close(0)].map((p) => p?.catch((e: Error) => log('warn', 'oracle pool close', { error: e.message }))));
    this.roPool = this.execPool = undefined;
  }
}
