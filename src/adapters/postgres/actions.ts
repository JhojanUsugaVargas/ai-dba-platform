// PostgreSQL implementations of catalog actions. SQL is built here, deterministically, from validated parameters
// with quoted identifiers. Preconditions, baseline/after capture and verification use the RO identity only.
import type { ActionImpl, PreconditionResult, Target, VerificationResult } from '../../core/types.ts';
import type { PgConnections } from './connection.ts';
import { loadProbes, runProbe, type ProbeResult } from './probes.ts';

const REL_STATE = `
  SELECT c.oid::bigint AS oid, c.relkind, c.relpages, c.reltuples::bigint AS reltuples, c.reloptions,
         s.n_live_tup, s.n_mod_since_analyze, s.last_analyze, s.last_autoanalyze,
         current_setting('autovacuum_analyze_threshold')::float AS av_thr,
         current_setting('autovacuum_analyze_scale_factor')::float AS av_sf,
         current_setting('default_statistics_target')::int AS stats_target,
         has_table_privilege($3, c.oid, 'MAINTAIN') AS exec_has_maintain,
         pg_has_role($3, c.relowner, 'USAGE') AS exec_is_owner,
         (SELECT count(*) FROM pg_stat_progress_analyze p WHERE p.relid = c.oid)::int AS analyze_running,
         (SELECT count(*) FROM pg_stat_progress_vacuum p WHERE p.relid = c.oid)::int AS vacuum_running,
         (SELECT count(*) FROM pg_locks l WHERE l.relation = c.oid AND l.granted
            AND l.mode IN ('ShareUpdateExclusiveLock','ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock'))::int AS conflicting_locks
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE n.nspname = $1 AND c.relname = $2`;

export function postgresActions(conn: PgConnections, target: Target, root: string): Record<string, ActionImpl> {
  const rel = (p: Record<string, any>) => `${conn.quoteIdent(p.schema)}.${conn.quoteIdent(p.table)}`;
  const state = async (p: Record<string, any>) => (await conn.ro(REL_STATE, [p.schema, p.table, target.exec_user]))[0];
  const probesFor = (p: Record<string, any>) => loadProbes(root, target.database).filter((pr) => pr.tables.includes(`${p.schema}.${p.table}`));

  const analyzeTable: ActionImpl = {
    buildSql: (p) => `ANALYZE ${rel(p)}`,

    async preconditions(p): Promise<PreconditionResult> {
      const s = await state(p);
      if (!s) return { checks: [{ id: 'exists', description: 'Table exists', ok: false, observed: null }], state: { exists: false } };
      const threshold = s.av_thr + s.av_sf * Math.max(Number(s.reltuples), 0);
      const mod = Number(s.n_mod_since_analyze ?? 0);
      return {
        checks: [
          { id: 'exists', description: 'Target is an existing table', ok: ['r', 'p'].includes(s.relkind), observed: s.relkind },
          { id: 'capability', description: `Exec identity (${target.exec_user}) holds MAINTAIN on the table`, ok: s.exec_has_maintain, observed: s.exec_has_maintain },
          { id: 'no_concurrent_maintenance', description: 'No ANALYZE/VACUUM currently running on the table', ok: s.analyze_running + s.vacuum_running === 0, observed: { analyze: s.analyze_running, vacuum: s.vacuum_running } },
          { id: 'no_conflicting_locks', description: 'No granted lock that conflicts with SHARE UPDATE EXCLUSIVE', ok: s.conflicting_locks === 0, observed: s.conflicting_locks },
          { id: 'still_needed', description: 'Statistics are still stale (modified rows > analyze threshold)', ok: mod > threshold, observed: { n_mod_since_analyze: mod, threshold: Math.round(threshold) } },
        ],
        // Fingerprint inputs: identity of the relation and the statistics state the approval was based on.
        state: { oid: s.oid, last_analyze: s.last_analyze, last_autoanalyze: s.last_autoanalyze, stale: mod > threshold, mod_order_of_magnitude: Math.floor(Math.log10(mod + 1)) },
      };
    },

    async estimate(p) {
      const s = await state(p);
      const sampleRows = 300 * s.stats_target;
      return {
        method: 'Catalog-based estimate (no execution): ANALYZE reads a random sample, not the whole table.',
        relpages: s.relpages,
        reltuples_at_last_analyze: Number(s.reltuples),
        default_statistics_target: s.stats_target,
        sample_rows: sampleRows,
        pages_to_read_upper_bound: Math.min(s.relpages, sampleRows),
        expected_duration: 'seconds (bounded by statement_timeout 60s)',
        data_modified: false,
      };
    },

    async capture(p) {
      const s = await state(p);
      const colStats = await conn.ro(
        `SELECT attname, null_frac, n_distinct, left(most_common_vals::text, 120) AS most_common_vals, left(most_common_freqs::text, 120) AS most_common_freqs
         FROM pg_stats WHERE schemaname = $1 AND tablename = $2 ORDER BY attname`,
        [p.schema, p.table],
      );
      const probes: ProbeResult[] = [];
      for (const pr of probesFor(p)) probes.push(await runProbe(conn, pr, 3));
      return { capturedAt: new Date().toISOString(), last_analyze: s.last_analyze, n_mod_since_analyze: Number(s.n_mod_since_analyze), reltuples: Number(s.reltuples), columnStats: colStats, probes };
    },

    verify(before, after): VerificationResult {
      const relName = (pr: ProbeResult) => pr.nodes;
      const checks: VerificationResult['checks'] = [
        { id: 'stats_refreshed', description: 'last_analyze advanced', before: before.last_analyze, after: after.last_analyze, ok: String(before.last_analyze) !== String(after.last_analyze) && after.last_analyze != null },
        { id: 'mod_reset', description: 'Rows modified since ANALYZE reset', before: before.n_mod_since_analyze, after: after.n_mod_since_analyze, ok: after.n_mod_since_analyze < Math.max(1000, before.n_mod_since_analyze * 0.05) },
      ];
      let improved = false;
      let degraded = false;
      for (const b of before.probes as ProbeResult[]) {
        const a = (after.probes as ProbeResult[]).find((x) => x.probeId === b.probeId);
        if (!a) continue;
        const bw = Math.max(...relName(b).map((n) => n.misestimate), 1);
        const aw = Math.max(...relName(a).map((n) => n.misestimate), 1);
        checks.push({ id: `misestimate:${b.probeId}`, description: `Worst row misestimate in "${b.name}" <= 10x`, before: bw, after: aw, ok: aw <= 10 });
        const latencyOk = a.medianMs <= b.medianMs * 1.2;
        checks.push({ id: `latency:${b.probeId}`, description: `Median latency of "${b.name}" not worse than +20%`, before: b.medianMs, after: a.medianMs, ok: latencyOk });
        if (!latencyOk) degraded = true;
        if (aw < bw || a.medianMs < b.medianMs * 0.9) improved = true;
      }
      const refreshed = checks[0].ok;
      const outcome = degraded ? 'DEGRADED' : !refreshed ? 'INCONCLUSIVE' : before.probes.length === 0 ? 'INCONCLUSIVE' : improved ? 'IMPROVED' : 'NO_CHANGE';
      const p0b = before.probes[0] as ProbeResult | undefined;
      const p0a = after.probes[0] as ProbeResult | undefined;
      const summary =
        outcome === 'IMPROVED' && p0b && p0a
          ? `Statistics refreshed. "${p0b.name}": median ${p0b.medianMs} ms -> ${p0a.medianMs} ms (${(p0b.medianMs / p0a.medianMs).toFixed(1)}x), worst misestimate ${Math.max(...p0b.nodes.map((n) => n.misestimate))}x -> ${Math.max(...p0a.nodes.map((n) => n.misestimate))}x.`
          : outcome === 'DEGRADED'
            ? 'A registered critical query got slower after the change. Statistics cannot be rolled back; escalate to a DBA.'
            : outcome === 'INCONCLUSIVE'
              ? 'The command completed but the expected effect could not be demonstrated with the available evidence.'
              : 'Statistics refreshed; no measurable change in registered queries.';
      return { outcome, checks, summary };
    },
  };

  const setTableAutovacuum: ActionImpl = {
    buildSql: (p) => (p.enabled ? `ALTER TABLE ${rel(p)} RESET (autovacuum_enabled)` : `ALTER TABLE ${rel(p)} SET (autovacuum_enabled = false)`),
    async preconditions(p) {
      const s = await state(p);
      if (!s) return { checks: [{ id: 'exists', description: 'Table exists', ok: false, observed: null }], state: { exists: false } };
      return {
        checks: [
          { id: 'exists', description: 'Target is an existing table', ok: ['r', 'p'].includes(s.relkind), observed: s.relkind },
          { id: 'capability', description: `Exec identity (${target.exec_user}) owns the table (MAINTAIN does not cover ALTER TABLE)`, ok: s.exec_is_owner, observed: s.exec_is_owner },
          { id: 'no_conflicting_locks', description: 'No granted lock that conflicts with SHARE UPDATE EXCLUSIVE', ok: s.conflicting_locks === 0, observed: s.conflicting_locks },
        ],
        state: { oid: s.oid, reloptions: s.reloptions },
      };
    },
    async estimate() {
      return { method: 'Metadata-only change', expected_duration: 'milliseconds', data_modified: false };
    },
    async capture(p) {
      const s = await state(p);
      return { reloptions: s.reloptions };
    },
    verify(before, after) {
      const ok = JSON.stringify(before.reloptions) !== JSON.stringify(after.reloptions);
      return { outcome: ok ? 'IMPROVED' : 'NO_CHANGE', checks: [{ id: 'reloptions', description: 'Storage parameter changed', before: before.reloptions, after: after.reloptions, ok }], summary: ok ? 'Storage parameter updated.' : 'No change detected.' };
    },
  };

  return { analyze_table: analyzeTable, set_table_autovacuum: setTableAutovacuum };
}
