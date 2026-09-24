// Offline checks for the Oracle adapter (no database needed): module loading, catalog wiring, SQL builders,
// and every rule against synthetic evidence shaped exactly like the dictionary rows the collectors return.
// This does NOT prove the SQL runs on Oracle — that needs a lab database (scripts/oracle-lab.ts).
import { createAdapter } from '../src/adapters/index.ts';
import { oracleRules } from '../src/adapters/oracle/rules.ts';
import { getAction, validateParams } from '../src/actions/catalog.ts';
import { evaluatePolicy } from '../src/actions/policy.ts';
import type { Evidence, EvidenceIndex, Target } from '../src/core/types.ts';

process.env.ORA_AGENT_RO_PASSWORD ??= 'x';
process.env.ORA_AGENT_EXEC_PASSWORD ??= 'x';
let fail = 0;
const expect = (c: unknown, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++; };

const target: Target = { id: 't', name: 'Oracle Lab', engine: 'oracle', host: '127.0.0.1', port: 1521, database: 'FREEPDB1', ro_user: 'AIDBA_RO', ro_secret_ref: 'env:ORA_AGENT_RO_PASSWORD', exec_user: 'AIDBA_EXEC', exec_secret_ref: 'env:ORA_AGENT_EXEC_PASSWORD', autonomy_level: 2 };
const adapter = createAdapter(target, process.cwd());
expect(adapter.engine === 'oracle', `adapter ${adapter.engine} ${adapter.supportedVersions}`);
expect(adapter.collectors().length === 14, `${adapter.collectors().length} collectors: ${adapter.collectors().map((c) => c.id).join(', ')}`);
const gp = adapter.action('gather_pending_stats')!, pp = adapter.action('publish_pending_stats')!;
expect(gp.buildSql({ schema: 'aidba_shop', table: 'orders' }) === "BEGIN AIDBA_SHOP.DBA_MAINT.GATHER_PENDING('ORDERS'); END;", `SQL: ${gp.buildSql({ schema: 'aidba_shop', table: 'orders' })}`);
expect(pp.buildSql({ schema: 'aidba_shop', table: 'orders' }) === "BEGIN AIDBA_SHOP.DBA_MAINT.PUBLISH_PENDING('ORDERS'); END;", `SQL: ${pp.buildSql({ schema: 'aidba_shop', table: 'orders' })}`);
const bad = validateParams(getAction('gather_pending_stats')!, { schema: 'aidba_shop', table: "orders'); DROP TABLE x; --" });
expect(!bad.ok, `injection attempt rejected by catalog: ${(bad as any).error}`);

const execReport = { identity: 'exec' as const, user: 'AIDBA_EXEC', verdict: 'OK' as const, checks: [], capabilities: ['EXECUTE:AIDBA_SHOP.DBA_MAINT'] };
const pol = evaluatePolicy(getAction('gather_pending_stats')!, { schema: 'aidba_shop', table: 'orders' }, target, execReport, false);
expect(pol.decision === 'REQUIRES_APPROVAL', `policy at RECOMMEND: ${pol.decision} (${pol.reasons.join(' | ')})`);
const polNoCap = evaluatePolicy(getAction('publish_pending_stats')!, { schema: 'other', table: 'orders' }, target, execReport, false);
expect(polNoCap.decision === 'DENIED', `policy without EXECUTE on OTHER.DBA_MAINT: ${polNoCap.decision}`);

const probe = (pending: boolean, est: number, act: number, ms: number) => ({
  probeId: 'recent_orders_by_region', name: 'Recent orders report by region', runsMs: [ms, ms, ms], medianMs: ms, sloMs: 400,
  planShape: ['SELECT STATEMENT'], nodes: [{ node: 'TABLE ACCESS BY INDEX ROWID BATCHED', relation: 'aidba_shop.orders', estRows: est, actualRows: act, loops: 1, misestimate: Math.max(est, act) / Math.max(Math.min(est, act), 1) }],
  worst: { node: 'TABLE ACCESS BY INDEX ROWID BATCHED', relation: 'aidba_shop.orders', estRows: est, actualRows: act, loops: 1, misestimate: Math.max(est, act) / Math.max(Math.min(est, act), 1) },
  sharedHit: 0, sharedRead: 0, sqlId: 'abc123', planHashValue: pending ? 222 : 111, adaptivePlanResolved: 'Y', reoptimizable: 'N', pendingStatistics: pending,
});
const statsRow = (pending: number) => ({ OWNER: 'AIDBA_SHOP', TABLE_NAME: 'ORDERS', NUM_ROWS: 400000, BLOCKS: 3000, LAST_ANALYZED: new Date('2026-09-20'), STALE_STATS: 'YES', STATTYPE_LOCKED: null, INSERTS: 150000, UPDATES: 0, DELETES: 0, PENDING_COUNT: pending, PENDING_ANALYZED: pending ? new Date() : null, STALE_PERCENT: '10', PUBLISH_PREF: pending ? 'FALSE' : 'TRUE' });
function index(items: Evidence[]): EvidenceIndex {
  return { byCollector: (c) => items.filter((e) => e.collector === c), first: (c) => items.find((e) => e.collector === c) };
}
const common: Evidence[] = [
  { id: 'e1', collector: 'instance', source: 'v$', data: { LOG_MODE: 'NOARCHIVELOG', FORCE_LOGGING: 'NO', FLASHBACK_ON: 'NO', DATABASE_ROLE: 'PRIMARY' } },
  { id: 'e2', collector: 'autotask', source: 'dba', data: [{ CLIENT_NAME: 'auto optimizer stats collection', STATUS: 'ENABLED' }] },
  { id: 'e3', collector: 'backups', source: 'v$', data: [] },
  { id: 'e4', collector: 'blocking', source: 'v$', data: [] },
  { id: 'e5', collector: 'tablespaces', source: 'dba', data: [{ TABLESPACE_NAME: 'USERS', USED_PERCENT: 12, USED_BYTES: 1e9, MAX_BYTES: 3e10, CONTENTS: 'PERMANENT' }] },
  { id: 'e6', collector: 'parameters', source: 'v$', data: { control_management_pack_access: { value: 'DIAGNOSTIC+TUNING', isdefault: 'TRUE' } } },
  { id: 'e7', collector: 'security', source: 'dba', data: { defaultPasswordOpen: [], dbaGrantees: [] } },
  { id: 'e8', collector: 'sessions', source: 'v$', data: { byState: [], limits: [{ RESOURCE_NAME: 'processes', CURRENT_UTILIZATION: 60, MAX_UTILIZATION: 70, LIMIT_VALUE: '300' }] } },
];
const run = (ev: Evidence[]) => oracleRules.flatMap((r) => r.evaluate(index(ev)).map((f) => ({ ...f })));

// Phase 1: stale, no pending.
const f1 = run([...common, { id: 's', collector: 'statistics', source: 'dba', data: [statsRow(0)] }, { id: 'p', collector: 'probes', source: 'v$', data: probe(false, 1, 150000, 2300) }]);
const titles1 = f1.map((f) => `[${f.severity}] ${f.ruleId}`);
console.log('      phase 1 findings:', titles1.join(', '));
expect(f1.some((f) => f.ruleId === 'ORA-STATS-STALE' && f.severity === 'HIGH' && f.candidateActions[0]?.actionId === 'gather_pending_stats'), 'stale stats -> HIGH, candidate gather_pending_stats');
expect(f1.some((f) => f.ruleId === 'ORA-PLAN-MISESTIMATE' && f.severity === 'HIGH' && f.candidateActions[0]?.actionId === 'gather_pending_stats'), 'misestimate 150000x -> HIGH, candidate gather_pending_stats');
expect(f1.some((f) => f.ruleId === 'ORA-NOARCHIVELOG'), 'NOARCHIVELOG detected');
expect(f1.some((f) => f.ruleId === 'ORA-RMAN-BACKUP'), 'no RMAN backup detected');
expect(f1.some((f) => f.ruleId === 'ORA-PACK-ACCESS' && f.severity === 'INFO'), 'management pack access -> INFO licensing note');
expect(!f1.some((f) => f.ruleId === 'ORA-PENDING-STATS'), 'no pending finding before gather');

// Phase 2: pending stats validated.
const f2 = run([...common, { id: 's', collector: 'statistics', source: 'dba', data: [statsRow(1)] }, { id: 'p', collector: 'probes', source: 'v$', data: probe(false, 1, 150000, 2300) }, { id: 'pp', collector: 'probes', source: 'v$', data: probe(true, 140000, 150000, 350) }]);
console.log('      phase 2 findings:', f2.map((f) => `[${f.severity}] ${f.ruleId}`).join(', '));
expect(f2.some((f) => f.ruleId === 'ORA-PENDING-STATS' && f.candidateActions[0]?.actionId === 'publish_pending_stats'), 'validated pending stats -> candidate publish_pending_stats');
expect(f2.some((f) => f.ruleId === 'ORA-PLAN-MISESTIMATE' && f.candidateActions[0]?.actionId === 'publish_pending_stats'), 'misestimate with pending present -> candidate publish');
expect(!f2.some((f) => f.ruleId === 'ORA-STATS-STALE'), 'stale finding suppressed while pending stats exist');

// Phase 3: pending stats that would degrade.
const f3 = run([...common, { id: 's', collector: 'statistics', source: 'dba', data: [statsRow(1)] }, { id: 'p', collector: 'probes', source: 'v$', data: probe(false, 1, 150000, 300) }, { id: 'pp', collector: 'probes', source: 'v$', data: probe(true, 140000, 150000, 900) }]);
expect(f3.some((f) => f.ruleId === 'ORA-PENDING-STATS' && f.severity === 'HIGH' && f.candidateActions.length === 0), 'pending stats that slow the query -> HIGH, no publish candidate');

// Verification logic.
const v = pp.verify({ last_analyzed: 'a', pending_count: 1, probes: [probe(false, 1, 150000, 2300)] }, { last_analyzed: 'b', pending_count: 0, probes: [probe(false, 140000, 150000, 350)] });
expect(v.outcome === 'IMPROVED', `publish verify: ${v.outcome} — ${v.summary}`);
const vg = gp.verify({ last_analyzed: 'a', pending_count: 0, probes: [probe(false, 1, 150000, 2300)] }, { last_analyzed: 'a', pending_count: 1, probes: [probe(true, 140000, 150000, 350)] });
expect(vg.outcome === 'IMPROVED' && vg.checks.find((c) => c.id === 'published_unchanged')?.ok, `gather-pending verify: ${vg.outcome}; published statistics unchanged`);
await adapter.close();
console.log(fail ? `\n${fail} FAILED` : '\nALL OFFLINE CHECKS PASSED (Oracle SQL itself still needs a lab database)');
process.exitCode = fail ? 1 : 0;
