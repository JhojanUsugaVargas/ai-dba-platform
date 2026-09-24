import type { ActionImpl, CollectorDef, EngineAdapter, Rule, Target } from '../../core/types.ts';
import { PgConnections } from './connection.ts';
import { postgresCollectors } from './collectors.ts';
import { postgresRules } from './rules.ts';
import { postgresActions } from './actions.ts';
import { validateExec, validateRo } from './permissions.ts';

export class PostgresAdapter implements EngineAdapter {
  readonly engine = 'postgresql';
  readonly supportedVersions = '17.x';
  private conn: PgConnections;
  private actions: Record<string, ActionImpl>;
  private target: Target;
  private root: string;
  private disabledCollectors: Set<string>;

  constructor(target: Target, root: string, disabledCollectors = new Set<string>()) {
    this.target = target;
    this.root = root;
    this.disabledCollectors = disabledCollectors;
    this.conn = new PgConnections(target);
    this.actions = postgresActions(this.conn, target, root);
  }

  async connectAndIdentify() {
    const [r] = await this.conn.ro(`SELECT current_setting('server_version') AS v, current_setting('server_version_num')::int AS n`);
    return { version: r.v, versionNum: r.n, supported: r.n >= 170000 && r.n < 180000 };
  }

  async validatePermissions() {
    return { ro: await validateRo(this.conn), exec: await validateExec(this.conn, this.target.exec_user) };
  }

  collectors(): CollectorDef[] {
    return postgresCollectors(this.conn, this.target, this.root, this.disabledCollectors);
  }

  rules(): Rule[] {
    return postgresRules;
  }

  action(actionId: string): ActionImpl | undefined {
    return this.actions[actionId];
  }

  executeAuthorized(sql: string, opts: { statementTimeoutMs: number; lockTimeoutMs: number }) {
    return this.conn.exec(sql, opts.statementTimeoutMs, opts.lockTimeoutMs);
  }

  close() {
    return this.conn.close();
  }
}

// Kept for existing imports (scripts); the registry lives in src/adapters/index.ts.
export { createAdapter } from '../index.ts';
