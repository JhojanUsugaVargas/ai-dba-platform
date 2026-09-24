import type { ActionImpl, CollectorDef, EngineAdapter, Rule, Target } from '../../core/types.ts';
import { OraConnections } from './connection.ts';
import { oracleCollectors } from './collectors.ts';
import { oracleRules } from './rules.ts';
import { oracleActions } from './actions.ts';
import { validateOraExec, validateOraRo } from './permissions.ts';

export class OracleAdapter implements EngineAdapter {
  readonly engine = 'oracle';
  readonly supportedVersions = '19c, 21c, 23ai';
  private conn: OraConnections;
  private actions: Record<string, ActionImpl>;
  private target: Target;
  private root: string;
  private disabledCollectors: Set<string>;

  constructor(target: Target, root: string, disabledCollectors = new Set<string>()) {
    this.target = target;
    this.root = root;
    this.disabledCollectors = disabledCollectors;
    this.conn = new OraConnections(target);
    this.actions = oracleActions(this.conn, target, root);
  }

  async connectAndIdentify() {
    const [r] = await this.conn.ro(`SELECT version_full AS v, TO_NUMBER(REGEXP_SUBSTR(version, '^[0-9]+')) AS major FROM v$instance`);
    const major = Number(r.MAJOR);
    return { version: String(r.V), versionNum: major, supported: major >= 19 };
  }

  async validatePermissions() {
    return { ro: await validateOraRo(this.conn), exec: await validateOraExec(this.conn, this.target.exec_user) };
  }

  collectors(): CollectorDef[] {
    return oracleCollectors(this.conn, this.target, this.root, this.disabledCollectors);
  }

  rules(): Rule[] {
    return oracleRules;
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
