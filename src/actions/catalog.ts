// Closed action catalog (engine-neutral metadata). The LLM can only pick an id from here and supply parameters
// that pass these validators. SQL is produced by the engine adapter, never by the model.
import type { Risk } from '../core/types.ts';

export interface ParamSpec {
  name: string;
  type: 'identifier' | 'boolean';
  description: string;
}

export interface ActionDef {
  id: string;
  title: string;
  description: string;
  risk: Risk;
  category: 'MAINTENANCE' | 'CONFIGURATION';
  params: ParamSpec[];
  destructive: boolean;
  reversible: boolean;
  rollback: string;
  lockImpact: string;
  requiredCapability: (p: Record<string, any>) => string;
  engines: string[];
}

export const CATALOG: ActionDef[] = [
  {
    id: 'analyze_table',
    title: 'Refresh planner statistics (ANALYZE)',
    description: 'Collects a fresh statistical sample of one table so the query planner estimates row counts correctly.',
    risk: 'LOW',
    category: 'MAINTENANCE',
    params: [
      { name: 'schema', type: 'identifier', description: 'Schema of the table' },
      { name: 'table', type: 'identifier', description: 'Table name' },
    ],
    destructive: false,
    reversible: false,
    rollback: 'No rollback: PostgreSQL 17 cannot restore previous statistics. The action does not modify data; statistics can be gathered again. Post-change validation is the safety net, and a plan regression triggers an alert and DBA escalation.',
    lockImpact: 'SHARE UPDATE EXCLUSIVE on the table: does not block SELECT/INSERT/UPDATE/DELETE; waits on (and is waited by) VACUUM, DDL and other ANALYZE. Bounded by lock_timeout.',
    requiredCapability: (p) => `MAINTAIN:${p.schema}.${p.table}`,
    engines: ['postgresql'],
  },
  {
    id: 'set_table_autovacuum',
    title: 'Enable/disable autovacuum for a table',
    description: 'Changes the per-table autovacuum_enabled storage parameter.',
    risk: 'MEDIUM',
    category: 'CONFIGURATION',
    params: [
      { name: 'schema', type: 'identifier', description: 'Schema of the table' },
      { name: 'table', type: 'identifier', description: 'Table name' },
      { name: 'enabled', type: 'boolean', description: 'true to re-enable autovacuum' },
    ],
    destructive: false,
    reversible: true,
    rollback: 'Re-apply the previous storage parameter value (captured before execution).',
    lockImpact: 'ALTER TABLE ... SET/RESET (autovacuum_enabled) takes SHARE UPDATE EXCLUSIVE; metadata-only.',
    requiredCapability: (p) => `OWNER:${p.schema}.${p.table}`,
    engines: ['postgresql'],
  },
  {
    id: 'gather_pending_stats',
    title: 'Gather optimizer statistics as PENDING (validate before publishing)',
    description: 'DBMS_STATS gathers into the pending area (PUBLISH=FALSE). The optimizer keeps using the published statistics; the platform validates the pending ones by running the registered probes in an isolated session with optimizer_use_pending_statistics=TRUE.',
    risk: 'LOW',
    category: 'MAINTENANCE',
    params: [
      { name: 'schema', type: 'identifier', description: 'Table owner' },
      { name: 'table', type: 'identifier', description: 'Table name' },
    ],
    destructive: false,
    reversible: true,
    rollback: 'DBA_MAINT.DELETE_PENDING(table) discards the pending statistics (DBMS_STATS.DELETE_PENDING_STATS). Nothing visible to the application changes in this step.',
    lockImpact: 'Reads the table (AUTO_SAMPLE_SIZE); no locks that block application DML; the application optimizer does not see the new statistics until they are published.',
    requiredCapability: (p) => `EXECUTE:${String(p.schema).toUpperCase()}.DBA_MAINT`,
    engines: ['oracle'],
  },
  {
    id: 'publish_pending_stats',
    title: 'Publish validated pending statistics',
    description: 'DBMS_STATS.PUBLISH_PENDING_STATS with no_invalidate => FALSE, so dependent cursors re-parse with the validated statistics.',
    risk: 'LOW',
    category: 'MAINTENANCE',
    params: [
      { name: 'schema', type: 'identifier', description: 'Table owner' },
      { name: 'table', type: 'identifier', description: 'Table name' },
    ],
    destructive: false,
    reversible: true,
    rollback: 'Reversible: Oracle keeps statistics history (retention default 31 days). DBA_MAINT.RESTORE_STATS(table, as_of) runs DBMS_STATS.RESTORE_TABLE_STATS to the timestamp recorded in DBA_MAINT_LOG just before publication.',
    lockImpact: 'Dictionary update only; dependent cursors are invalidated immediately (hard parse on next execution).',
    requiredCapability: (p) => `EXECUTE:${String(p.schema).toUpperCase()}.DBA_MAINT`,
    engines: ['oracle'],
  },
];

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

export function getAction(id: unknown): ActionDef | undefined {
  return CATALOG.find((a) => a.id === id);
}

// Strict validation: unknown actions, unknown params, missing params or malformed identifiers are rejected.
export function validateParams(def: ActionDef, params: unknown): { ok: true; params: Record<string, any> } | { ok: false; error: string } {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { ok: false, error: 'params must be an object' };
  const p = params as Record<string, unknown>;
  const extra = Object.keys(p).filter((k) => !def.params.some((s) => s.name === k));
  if (extra.length) return { ok: false, error: `unknown parameter(s): ${extra.join(', ')}` };
  const out: Record<string, any> = {};
  for (const s of def.params) {
    const v = p[s.name];
    if (v === undefined) return { ok: false, error: `missing parameter: ${s.name}` };
    if (s.type === 'identifier' && (typeof v !== 'string' || !IDENT.test(v))) return { ok: false, error: `invalid identifier for ${s.name}` };
    if (s.type === 'boolean' && typeof v !== 'boolean') return { ok: false, error: `${s.name} must be boolean` };
    out[s.name] = v;
  }
  return { ok: true, params: out };
}
