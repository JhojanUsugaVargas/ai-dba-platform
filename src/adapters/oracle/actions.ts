// Oracle implementations of catalog actions. The exec identity has only EXECUTE on <schema>.DBA_MAINT, a
// definer-rights package owned by the schema owner that accepts allow-listed tables only (no ANALYZE ANY).
// Two-step statistics change, the Oracle way:
//   1. gather_pending_stats : statistics go to the pending area (PUBLISH=FALSE) — invisible to the optimizer.
//                             Verified by running the probe in an isolated session with optimizer_use_pending_statistics.
//   2. publish_pending_stats: publish with no_invalidate=>FALSE; reversible with DBMS_STATS.RESTORE_TABLE_STATS.
import type { ActionImpl, PreconditionResult, Target, VerificationResult } from '../../core/types.ts';
import type { OraConnections } from './connection.ts';
import { loadOraProbes, runOraProbe, type OraProbeResult } from './probes.ts';

const up = (s: string) => s.toUpperCase(); // identifiers already validated by the catalog (^[a-z_][a-z0-9_]*$)

export function oracleActions(conn: OraConnections, target: Target, root: string): Record<string, ActionImpl> {
  const probesFor = (p: Record<string, any>) => loadOraProbes(root).filter((pr) => pr.tables.includes(`${p.schema}.${p.table}`));
  const state = async (p: Record<string, any>) =>
    (await conn.ro(`
      SELECT t.table_name, s.num_rows, s.blocks, s.last_analyzed, s.stale_stats, s.stattype_locked,
             (SELECT COUNT(*) FROM dba_tab_pending_stats ps WHERE ps.owner = t.owner AND ps.table_name = t.table_name) AS pending_count,
             (SELECT MAX(ps.last_analyzed) FROM dba_tab_pending_stats ps WHERE ps.owner = t.owner AND ps.table_name = t.table_name) AS pending_analyzed,
             (SELECT COUNT(*) FROM dba_tab_privs g WHERE g.grantee = :ex AND g.owner = t.owner AND g.table_name = 'DBA_MAINT' AND g.privilege = 'EXECUTE') AS exec_grant,
             (SELECT COUNT(*) FROM v$session_longops l WHERE l.opname LIKE 'Gather%' AND l.target LIKE t.owner || '.' || t.table_name || '%' AND l.sofar < l.totalwork) AS gather_running,
             NVL(m.inserts, 0) + NVL(m.updates, 0) + NVL(m.deletes, 0) AS modifications
      FROM dba_tables t JOIN dba_tab_statistics s ON s.owner = t.owner AND s.table_name = t.table_name AND s.object_type = 'TABLE'
      LEFT JOIN dba_tab_modifications m ON m.table_owner = t.owner AND m.table_name = t.table_name AND m.partition_name IS NULL
      WHERE t.owner = :o AND t.table_name = :t`, { o: up(p.schema), t: up(p.table), ex: up(target.exec_user) }))[0];

  const allowlisted = async (p: Record<string, any>) =>
    Number((await conn.ro(`SELECT COUNT(*) AS n FROM ${up(p.schema)}.dba_maint_allowlist WHERE table_name = :t`, { t: up(p.table) }).catch(() => [{ N: 0 }]))[0].N) > 0;

  const commonChecks = async (p: Record<string, any>, s: any) => [
    { id: 'exists', description: 'Target table exists', ok: Boolean(s), observed: s?.TABLE_NAME ?? null },
    { id: 'capability', description: `Exec identity (${up(target.exec_user)}) holds EXECUTE on ${up(p.schema)}.DBA_MAINT (no ANALYZE ANY)`, ok: Number(s?.EXEC_GRANT ?? 0) > 0, observed: Number(s?.EXEC_GRANT ?? 0) },
    { id: 'allowlisted', description: `Table is in ${up(p.schema)}.DBA_MAINT_ALLOWLIST`, ok: await allowlisted(p), observed: up(p.table) },
    { id: 'not_locked', description: 'Statistics are not locked (STATTYPE_LOCKED is null)', ok: !s?.STATTYPE_LOCKED, observed: s?.STATTYPE_LOCKED ?? null },
    { id: 'no_gather_running', description: 'No DBMS_STATS gather running on the table (V$SESSION_LONGOPS)', ok: Number(s?.GATHER_RUNNING ?? 0) === 0, observed: Number(s?.GATHER_RUNNING ?? 0) },
  ];

  const probeSet = async (p: Record<string, any>, pending: boolean) => {
    const out: OraProbeResult[] = [];
    for (const pr of probesFor(p)) out.push(await runOraProbe(conn, pr, { pending }));
    return out;
  };

  const compare = (before: OraProbeResult[], after: OraProbeResult[], checks: VerificationResult['checks'], label: string) => {
    let improved = false, degraded = false;
    for (const b of before) {
      const a = after.find((x) => x.probeId === b.probeId);
      if (!a) continue;
      const bw = Math.max(1, ...b.nodes.map((n) => n.misestimate));
      const aw = Math.max(1, ...a.nodes.map((n) => n.misestimate));
      checks.push({ id: `misestimate:${b.probeId}`, description: `Worst E-Rows/A-Rows in "${b.name}" <= 10x ${label}`, before: bw, after: aw, ok: aw <= 10 });
      const ok = a.medianMs <= b.medianMs * 1.2;
      checks.push({ id: `latency:${b.probeId}`, description: `Median latency of "${b.name}" not worse than +20% ${label}`, before: b.medianMs, after: a.medianMs, ok });
      checks.push({ id: `plan:${b.probeId}`, description: `Plan hash value of "${b.name}"`, before: b.planHashValue, after: a.planHashValue, ok: true });
      if (!ok) degraded = true;
      if (aw < bw || a.medianMs < b.medianMs * 0.9) improved = true;
    }
    return { improved, degraded };
  };

  const gatherPending: ActionImpl = {
    buildSql: (p) => `BEGIN ${up(p.schema)}.DBA_MAINT.GATHER_PENDING('${up(p.table)}'); END;`,
    async preconditions(p): Promise<PreconditionResult> {
      const s = await state(p);
      const checks = await commonChecks(p, s);
      checks.push({ id: 'no_pending', description: 'No pending statistics already waiting for publication', ok: Number(s?.PENDING_COUNT ?? 0) === 0, observed: Number(s?.PENDING_COUNT ?? 0) });
      checks.push({ id: 'still_stale', description: 'Statistics are still stale (STALE_STATS = YES)', ok: s?.STALE_STATS === 'YES', observed: s?.STALE_STATS ?? null });
      return { checks, state: { last_analyzed: s?.LAST_ANALYZED ?? null, stale: s?.STALE_STATS ?? null, pending: Number(s?.PENDING_COUNT ?? 0), locked: s?.STATTYPE_LOCKED ?? null } };
    },
    async estimate(p) {
      const s = await state(p);
      return {
        method: 'Dictionary-based estimate (no execution). DBMS_STATS with AUTO_SAMPLE_SIZE (approximate NDV) reads the table once.',
        num_rows_at_last_gather: Number(s?.NUM_ROWS ?? 0), blocks: Number(s?.BLOCKS ?? 0), modifications_since: Number(s?.MODIFICATIONS ?? 0),
        expected_duration: 'seconds to tens of seconds (bounded by call timeout)', data_modified: false, visible_to_optimizer: false,
      };
    },
    async capture(p) {
      const s = await state(p);
      const hasPending = Number(s?.PENDING_COUNT ?? 0) > 0;
      return {
        capturedAt: new Date().toISOString(), last_analyzed: s?.LAST_ANALYZED ?? null, pending_count: Number(s?.PENDING_COUNT ?? 0), pending_analyzed: s?.PENDING_ANALYZED ?? null,
        // Baseline = what the application sees. After the gather = the probe evaluated with the pending statistics.
        probes: await probeSet(p, hasPending),
        publishedProbes: hasPending ? await probeSet(p, false) : undefined,
      };
    },
    verify(before, after): VerificationResult {
      const checks: VerificationResult['checks'] = [
        { id: 'pending_created', description: 'Pending statistics were created', before: before.pending_count, after: after.pending_count, ok: after.pending_count > 0 },
        { id: 'published_unchanged', description: 'Published statistics unchanged (the application is not affected yet)', before: before.last_analyzed, after: after.last_analyzed, ok: String(before.last_analyzed) === String(after.last_analyzed) },
      ];
      const { improved, degraded } = compare(before.probes, after.probes, checks, '(with pending statistics)');
      const ok = checks[0].ok && checks[1].ok;
      const outcome = !ok ? 'INCONCLUSIVE' : degraded ? 'DEGRADED' : !before.probes.length ? 'INCONCLUSIVE' : improved ? 'IMPROVED' : 'NO_CHANGE';
      const b = before.probes[0] as OraProbeResult | undefined, a = after.probes[0] as OraProbeResult | undefined;
      const summary = outcome === 'IMPROVED' && a && b
        ? `Pending statistics validated in an isolated session: "${b.name}" ${b.medianMs} ms -> ${a.medianMs} ms, worst E-Rows/A-Rows ${Math.max(...b.nodes.map((n) => n.misestimate))}x -> ${Math.max(...a.nodes.map((n) => n.misestimate))}x. The application still uses the published statistics; publishing is a separate, approved change.`
        : outcome === 'DEGRADED' ? 'With the pending statistics the critical query would get slower. Do not publish; DBA_MAINT.DELETE_PENDING discards them.'
        : outcome === 'INCONCLUSIVE' ? 'The gather completed but its effect could not be demonstrated with the available evidence.'
        : 'Pending statistics created; no measurable change in registered queries.';
      return { outcome, checks, summary };
    },
  };

  const publishPending: ActionImpl = {
    buildSql: (p) => `BEGIN ${up(p.schema)}.DBA_MAINT.PUBLISH_PENDING('${up(p.table)}'); END;`,
    async preconditions(p): Promise<PreconditionResult> {
      const s = await state(p);
      const checks = await commonChecks(p, s);
      checks.push({ id: 'pending_exists', description: 'Pending statistics exist', ok: Number(s?.PENDING_COUNT ?? 0) > 0, observed: Number(s?.PENDING_COUNT ?? 0) });
      return { checks, state: { published_last_analyzed: s?.LAST_ANALYZED ?? null, pending_analyzed: s?.PENDING_ANALYZED ?? null, locked: s?.STATTYPE_LOCKED ?? null } };
    },
    async estimate(p) {
      const s = await state(p);
      return {
        method: 'Dictionary operation: copies pending statistics to the published dictionary.',
        pending_analyzed: s?.PENDING_ANALYZED ?? null, expected_duration: 'seconds', data_modified: false,
        cursor_impact: 'Dependent cursors are invalidated immediately (no_invalidate => FALSE): next executions hard-parse with the new statistics.',
      };
    },
    async capture(p) {
      const s = await state(p);
      return { capturedAt: new Date().toISOString(), last_analyzed: s?.LAST_ANALYZED ?? null, pending_count: Number(s?.PENDING_COUNT ?? 0), probes: await probeSet(p, false) };
    },
    verify(before, after): VerificationResult {
      const checks: VerificationResult['checks'] = [
        { id: 'stats_published', description: 'Published LAST_ANALYZED advanced', before: before.last_analyzed, after: after.last_analyzed, ok: String(before.last_analyzed) !== String(after.last_analyzed) && after.last_analyzed != null },
        { id: 'pending_cleared', description: 'Pending statistics consumed', before: before.pending_count, after: after.pending_count, ok: after.pending_count === 0 },
      ];
      const { improved, degraded } = compare(before.probes, after.probes, checks, '');
      const outcome = degraded ? 'DEGRADED' : !checks[0].ok ? 'INCONCLUSIVE' : !before.probes.length ? 'INCONCLUSIVE' : improved ? 'IMPROVED' : 'NO_CHANGE';
      const b = before.probes[0] as OraProbeResult | undefined, a = after.probes[0] as OraProbeResult | undefined;
      const summary = outcome === 'IMPROVED' && a && b
        ? `Statistics published. "${b.name}": median ${b.medianMs} ms -> ${a.medianMs} ms (${(b.medianMs / a.medianMs).toFixed(1)}x), worst E-Rows/A-Rows ${Math.max(...b.nodes.map((n) => n.misestimate))}x -> ${Math.max(...a.nodes.map((n) => n.misestimate))}x, plan hash ${b.planHashValue} -> ${a.planHashValue}.`
        : outcome === 'DEGRADED' ? `A registered critical query got slower. Rollback available: DBA_MAINT.RESTORE_STATS to the timestamp recorded in DBA_MAINT_LOG (DBMS_STATS.RESTORE_TABLE_STATS).`
        : outcome === 'INCONCLUSIVE' ? 'The command completed but the expected effect could not be demonstrated with the available evidence.'
        : 'Statistics published; no measurable change in registered queries.';
      return { outcome, checks, summary };
    },
  };

  return { gather_pending_stats: gatherPending, publish_pending_stats: publishPending };
}
