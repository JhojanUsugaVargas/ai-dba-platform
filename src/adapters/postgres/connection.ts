// Two physically separate pools. The application - not the LLM - decides which identity an operation uses:
//   ro   -> assessment, monitoring, diagnostics, evidence, precondition checks, verification
//   exec -> only executeAuthorized(), called only by the Executor after policy + approval + revalidation
import pg from 'pg';
import type { Target } from '../../core/types.ts';
import { log } from '../../core/util.ts';

export function resolveSecret(ref: string): string {
  const [scheme, name] = ref.split(':', 2);
  if (scheme !== 'env' || !name) throw new Error(`Unsupported secret reference scheme: ${scheme}`);
  const v = process.env[name];
  if (!v) throw new Error(`Secret reference ${ref} is not set in the environment`);
  return v;
}

export class PgConnections {
  private roPool?: pg.Pool;
  private execPool?: pg.Pool;

  private target: Target;
  constructor(target: Target) {
    this.target = target;
  }

  private pool(identity: 'ro' | 'exec'): pg.Pool {
    const t = this.target;
    const make = (user: string, ref: string, max: number) => {
      const pool = new pg.Pool({
        host: t.host,
        port: t.port,
        database: t.database,
        user,
        password: resolveSecret(ref),
        max,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
        application_name: `ai-dba-platform/${identity}`,
      });
      // An idle connection killed server-side (restart, pg_terminate_backend) must not crash the platform.
      pool.on('error', (e) => log('warn', 'idle database connection lost', { identity, error: e.message }));
      return pool;
    };
    if (identity === 'ro') return (this.roPool ??= make(t.ro_user, t.ro_secret_ref, 2));
    return (this.execPool ??= make(t.exec_user, t.exec_secret_ref, 1));
  }

  // Every RO statement runs inside a READ ONLY transaction with a per-statement timeout.
  async ro<T = any>(sql: string, params: unknown[] = [], timeoutMs = 3000): Promise<T[]> {
    try {
      return await this.roOnce<T>(sql, params, timeoutMs);
    } catch (e: any) {
      // A pooled connection killed server-side (57P01 admin_shutdown / terminated) is retried once on a fresh one.
      if (e?.code === '57P01' || /Connection terminated|connection.*closed/i.test(e?.message ?? '')) return this.roOnce<T>(sql, params, timeoutMs);
      throw e;
    }
  }

  private async roOnce<T>(sql: string, params: unknown[], timeoutMs: number): Promise<T[]> {
    const client = await this.pool('ro').connect();
    let broken: Error | undefined;
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SELECT set_config('statement_timeout', $1, true)", [String(timeoutMs)]);
      const r = await client.query(sql, params);
      await client.query('COMMIT');
      return r.rows as T[];
    } catch (e) {
      await client.query('ROLLBACK').catch((rb) => (broken = rb));
      throw e;
    } finally {
      client.release(broken); // a connection that cannot even ROLLBACK is discarded, not returned to the pool
    }
  }

  // Exec identity: session timeouts set explicitly for this statement, then reset.
  async exec(sql: string, statementTimeoutMs: number, lockTimeoutMs: number): Promise<{ command: string; ms: number }> {
    const client = await this.pool('exec').connect();
    try {
      await client.query("SELECT set_config('statement_timeout', $1, false), set_config('lock_timeout', $2, false)", [
        String(statementTimeoutMs),
        String(lockTimeoutMs),
      ]);
      const t0 = performance.now();
      const r = await client.query(sql);
      return { command: r.command, ms: Math.round(performance.now() - t0) };
    } finally {
      await client.query('RESET statement_timeout; RESET lock_timeout').catch(() => {});
      client.release();
    }
  }

  async execIdentityCheck(): Promise<string> {
    const client = await this.pool('exec').connect();
    try {
      return (await client.query('SELECT current_user AS u')).rows[0].u;
    } finally {
      client.release();
    }
  }

  quoteIdent(name: string): string {
    return pg.escapeIdentifier(name);
  }

  async close(): Promise<void> {
    await Promise.all([this.roPool?.end(), this.execPool?.end()]);
    this.roPool = this.execPool = undefined;
  }
}
