// Deterministic PostgreSQL rules. A finding exists only if a rule fires on collected evidence;
// every finding carries the evidence ids and the exact facts (numbers) the rule used.
import type { EvidenceIndex, FindingDraft, Rule, Severity } from '../../core/types.ts';
import type { ProbeResult } from './probes.ts';

const fmtBytes = (b: number) => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : `${(b / (1 << 20)).toFixed(0)} MB`);
const num = (v: unknown) => Number(v ?? 0);
const autovacuumDisabled = (reloptions: string[] | null) => (reloptions ?? []).some((o) => /^autovacuum_enabled=(false|off|0)$/i.test(o));

export const postgresRules: Rule[] = [
  {
    id: 'PG-STATS-STALE',
    dimension: 'Performance',
    description: 'Rows modified since last ANALYZE exceed the autovacuum analyze threshold (threshold + scale_factor * reltuples).',
    evaluate(ev) {
      const tables = ev.first('tables');
      const settings = ev.first('settings');
      if (!tables || !settings) return [];
      const thr = num(settings.data.autovacuum_analyze_threshold?.setting);
      const sf = num(settings.data.autovacuum_analyze_scale_factor?.setting);
      const probes = ev.byCollector('probes');
      const out: FindingDraft[] = [];
      for (const t of tables.data as any[]) {
        const limit = thr + sf * Math.max(num(t.reltuples), 0);
        const mod = num(t.n_mod_since_analyze);
        if (mod < 1000 || mod <= limit) continue;
        const rel = `${t.schemaname}.${t.relname}`;
        const avOff = autovacuumDisabled(t.reloptions);
        const hitProbes = probes.filter((p) => (p.data as ProbeResult).nodes.some((n) => n.relation === rel && n.misestimate >= 100));
        const severity: Severity = avOff || hitProbes.length ? 'HIGH' : 'LOW';
        out.push({
          ruleId: this.id, dimension: this.dimension, severity, object: rel,
          title: `Stale planner statistics on ${rel}`,
          detail: `${mod.toLocaleString('en-US')} rows modified since the last ANALYZE (${Math.round((mod / Math.max(num(t.n_live_tup), 1)) * 100)}% of live rows); the autovacuum analyze threshold is ${Math.round(limit).toLocaleString('en-US')}. ` +
            (avOff ? 'Autovacuum is disabled on this table, so it will not be re-analyzed automatically. ' : 'Autovacuum is enabled and should analyze it soon. ') +
            (hitProbes.length ? `A registered critical query misestimates rows on this table.` : ''),
          evidenceIds: [tables.id, settings.id, ...hitProbes.map((p) => p.id)],
          facts: { n_mod_since_analyze: mod, n_live_tup: num(t.n_live_tup), reltuples_at_last_analyze: num(t.reltuples), analyze_threshold: Math.round(limit), last_analyze: t.last_analyze, last_autoanalyze: t.last_autoanalyze, autovacuum_disabled: avOff },
          candidateActions: [{ actionId: 'analyze_table', params: { schema: t.schemaname, table: t.relname } }],
        });
      }
      return out;
    },
  },
  {
    id: 'PG-AUTOVACUUM-DISABLED',
    dimension: 'Maintenance',
    description: 'Autovacuum disabled globally or per table (reloptions autovacuum_enabled=false).',
    evaluate(ev) {
      const tables = ev.first('tables');
      const settings = ev.first('settings');
      const out: FindingDraft[] = [];
      if (settings && settings.data.autovacuum?.setting === 'off') {
        out.push({ ruleId: this.id, dimension: this.dimension, severity: 'HIGH', title: 'Autovacuum is disabled instance-wide', detail: 'autovacuum = off: dead tuples, statistics and transaction ID wraparound protection depend on manual maintenance.', evidenceIds: [settings.id], facts: { autovacuum: 'off' }, candidateActions: [] });
      }
      for (const t of (tables?.data as any[]) ?? []) {
        if (!autovacuumDisabled(t.reloptions)) continue;
        const rel = `${t.schemaname}.${t.relname}`;
        out.push({
          ruleId: this.id, dimension: this.dimension, severity: 'MEDIUM', object: rel,
          title: `Autovacuum disabled on ${rel}`,
          detail: `Table storage option ${t.reloptions.join(', ')}. Statistics and dead-tuple cleanup for this table depend on manual jobs. Frequently left behind by bulk-load runbooks.`,
          evidenceIds: [tables!.id],
          facts: { reloptions: t.reloptions, n_dead_tup: num(t.n_dead_tup), n_mod_since_analyze: num(t.n_mod_since_analyze), last_autovacuum: t.last_autovacuum },
          candidateActions: [{ actionId: 'set_table_autovacuum', params: { schema: t.schemaname, table: t.relname, enabled: true } }],
        });
      }
      return out;
    },
  },
  {
    id: 'PG-PLAN-MISESTIMATE',
    dimension: 'Performance',
    description: 'A registered critical query has a plan node whose estimated rows differ from actual rows by >= 10x.',
    evaluate(ev) {
      return ev.byCollector('probes').flatMap((p): FindingDraft[] => {
        const r = p.data as ProbeResult;
        if (!r.worst || r.worst.misestimate < 10) return [];
        const overSlo = r.medianMs > r.sloMs;
        return [{
          ruleId: this.id, dimension: this.dimension, severity: r.worst.misestimate >= 100 ? 'HIGH' : 'MEDIUM', object: r.worst.relation ?? undefined,
          title: `Row misestimate ${r.worst.misestimate.toLocaleString('en-US')}x in critical query "${r.name}"`,
          detail: `${r.worst.node} on ${r.worst.relation}: planner estimated ${r.worst.estRows.toLocaleString('en-US')} rows, actual ${r.worst.actualRows.toLocaleString('en-US')}. Median execution ${r.medianMs} ms over ${r.runsMs.length} runs (SLO ${r.sloMs} ms${overSlo ? ', breached' : ''}).`,
          evidenceIds: [p.id],
          facts: { probe: r.probeId, worst_node: r.worst, median_ms: r.medianMs, runs_ms: r.runsMs, slo_ms: r.sloMs, plan: r.planShape },
          candidateActions: r.nodes.filter((n) => n.misestimate >= 10 && n.relation).map((n) => {
            const [schema, table] = n.relation!.split('.');
            return { actionId: 'analyze_table', params: { schema, table } };
          }).filter((a, i, arr) => arr.findIndex((b) => b.params.table === a.params.table) === i),
        }];
      });
    },
  },
  {
    id: 'PG-NO-WAL-ARCHIVING',
    dimension: 'Backups',
    description: 'archive_mode is off: point-in-time recovery is impossible regardless of base backups.',
    evaluate(ev) {
      const w = ev.first('wal_archiving');
      if (!w) return [];
      const out: FindingDraft[] = [];
      if (w.data.archive_mode === 'off')
        out.push({ ruleId: this.id, dimension: this.dimension, severity: 'HIGH', title: 'WAL archiving disabled: no point-in-time recovery', detail: 'archive_mode = off. Even if base backups exist, data changed after the last backup cannot be recovered. Backup existence itself is not visible from inside PostgreSQL and remains UNKNOWN.', evidenceIds: [w.id], facts: { archive_mode: w.data.archive_mode, wal_level: w.data.wal_level }, candidateActions: [] });
      else if (num(w.data.failed_count) > 0 && (!w.data.last_archived_time || new Date(w.data.last_failed_time) > new Date(w.data.last_archived_time)))
        out.push({ ruleId: this.id, dimension: this.dimension, severity: 'CRITICAL', title: 'WAL archiving is failing', detail: `Last failure ${w.data.last_failed_time} is newer than the last success.`, evidenceIds: [w.id], facts: w.data, candidateActions: [] });
      return out;
    },
  },
  {
    id: 'PG-SSL-OFF',
    dimension: 'Security',
    description: 'TLS disabled. Severity depends on network exposure (listen_addresses).',
    evaluate(ev) {
      const s = ev.first('security');
      if (!s || s.data.ssl === 'on') return [];
      const loopbackOnly = String(s.data.listen_addresses).split(',').every((a: string) => ['127.0.0.1', 'localhost', '::1'].includes(a.trim()));
      return [{ ruleId: this.id, dimension: this.dimension, severity: loopbackOnly ? 'LOW' : 'HIGH', title: 'TLS (ssl) is disabled', detail: loopbackOnly ? 'ssl = off, but the server only listens on loopback, which limits exposure.' : `ssl = off while listening on ${s.data.listen_addresses}: credentials and data travel in clear text.`, evidenceIds: [s.id], facts: { ssl: s.data.ssl, listen_addresses: s.data.listen_addresses }, candidateActions: [] }];
    },
  },
  {
    id: 'PG-SHARED-BUFFERS-DEFAULT',
    dimension: 'Configuration',
    description: 'shared_buffers <= 128MB (initdb/compiled default) on a host with >= 8 GB RAM (only when host metrics describe the DB host).',
    evaluate(ev) {
      const s = ev.first('settings');
      const h = ev.first('host');
      if (!s || !h || h.data.unavailable) return [];
      const sb = s.data.shared_buffers;
      const bytes = num(sb.setting) * 8192; // pg_settings unit for shared_buffers is 8kB
      if (bytes > 128 * 2 ** 20 || h.data.memTotalBytes < 8 * 2 ** 30) return [];
      return [{ ruleId: this.id, dimension: this.dimension, severity: 'LOW', title: 'shared_buffers at default size', detail: `shared_buffers = ${fmtBytes(bytes)} (initdb default, source: ${sb.source}) on a host with ${fmtBytes(h.data.memTotalBytes)} RAM. Worth reviewing against workload and other processes on the host; not a change to apply blindly.`, evidenceIds: [s.id, h.id], facts: { shared_buffers_bytes: bytes, source: sb.source, host_ram_bytes: h.data.memTotalBytes }, candidateActions: [] }];
    },
  },
  {
    id: 'PG-STATEMENTS-MISSING',
    dimension: 'Performance',
    description: 'pg_stat_statements is not installed in this database.',
    evaluate(ev) {
      const s = ev.first('statements');
      if (!s || s.data.installed) return [];
      return [{ ruleId: this.id, dimension: this.dimension, severity: 'MEDIUM', title: 'pg_stat_statements not available', detail: 'Without it there is no workload-level evidence of which SQL consumes time.', evidenceIds: [s.id], facts: { installed: false }, candidateActions: [] }];
    },
  },
  {
    id: 'PG-CONNECTIONS-HIGH',
    dimension: 'Availability',
    description: 'Client backends above 80% of max_connections.',
    evaluate(ev) {
      const c = ev.first('connections');
      if (!c) return [];
      const pct = num(c.data.client_backends) / num(c.data.max_connections);
      if (pct < 0.8) return [];
      return [{ ruleId: this.id, dimension: this.dimension, severity: pct >= 0.95 ? 'CRITICAL' : 'HIGH', title: `Connection usage at ${Math.round(pct * 100)}%`, detail: `${c.data.client_backends} of ${c.data.max_connections} connections in use.`, evidenceIds: [c.id], facts: c.data, candidateActions: [] }];
    },
  },
  {
    id: 'PG-LONG-TX-BLOCKING',
    dimension: 'Availability',
    description: 'Sessions blocked by others, or transactions open longer than 5 minutes.',
    evaluate(ev) {
      const a = ev.first('activity');
      if (!a) return [];
      const out: FindingDraft[] = [];
      const blocked = (a.data.sessions as any[]).filter((s) => s.blocked_by?.length);
      const longTx = (a.data.sessions as any[]).filter((s) => num(s.xact_age_s) > 300);
      if (blocked.length) out.push({ ruleId: this.id, dimension: this.dimension, severity: 'HIGH', title: `${blocked.length} blocked session(s)`, detail: `Blocking PIDs: ${[...new Set(blocked.flatMap((s) => s.blocked_by))].join(', ')}.`, evidenceIds: [a.id], facts: { blocked: blocked.map((s) => ({ pid: s.pid, blocked_by: s.blocked_by, wait_s: s.query_age_s })) }, candidateActions: [] });
      if (longTx.length) out.push({ ruleId: this.id, dimension: this.dimension, severity: 'MEDIUM', title: `${longTx.length} transaction(s) open > 5 minutes`, detail: 'Long transactions hold back vacuum and can hold locks.', evidenceIds: [a.id], facts: { sessions: longTx.map((s) => ({ pid: s.pid, state: s.state, xact_age_s: s.xact_age_s })) }, candidateActions: [] });
      return out;
    },
  },
  {
    id: 'PG-XID-AGE',
    dimension: 'Maintenance',
    description: 'Transaction ID age approaching wraparound (warn 500M, critical 1B of ~2.1B).',
    evaluate(ev) {
      const d = ev.first('databases');
      if (!d) return [];
      return (d.data as any[]).filter((r) => num(r.xid_age) > 500_000_000).map((r) => ({
        ruleId: this.id, dimension: this.dimension, severity: (num(r.xid_age) > 1_000_000_000 ? 'CRITICAL' : 'HIGH') as Severity, object: r.datname,
        title: `Transaction ID age ${num(r.xid_age).toLocaleString('en-US')} in ${r.datname}`, detail: 'Requires anti-wraparound VACUUM before the database is forced into protection mode.', evidenceIds: [d.id], facts: r, candidateActions: [],
      }));
    },
  },
  {
    id: 'PG-DEAD-TUPLES',
    dimension: 'Maintenance',
    description: 'Dead tuples > 20% of live tuples and > 10,000 rows.',
    evaluate(ev) {
      const t = ev.first('tables');
      if (!t) return [];
      return (t.data as any[]).filter((r) => num(r.n_dead_tup) > 10_000 && num(r.n_dead_tup) > 0.2 * num(r.n_live_tup)).map((r) => ({
        ruleId: this.id, dimension: this.dimension, severity: 'MEDIUM' as Severity, object: `${r.schemaname}.${r.relname}`,
        title: `High dead tuple ratio on ${r.schemaname}.${r.relname}`, detail: `${num(r.n_dead_tup).toLocaleString('en-US')} dead vs ${num(r.n_live_tup).toLocaleString('en-US')} live tuples.`, evidenceIds: [t.id], facts: { n_dead_tup: r.n_dead_tup, n_live_tup: r.n_live_tup, last_autovacuum: r.last_autovacuum }, candidateActions: [],
      }));
    },
  },
  {
    id: 'PG-CACHE-HIT',
    dimension: 'Performance',
    description: 'Buffer cache hit ratio below 90% with > 100k block reads.',
    evaluate(ev) {
      const d = ev.first('db_stats');
      if (!d) return [];
      const hit = num(d.data.blks_hit), read = num(d.data.blks_read);
      if (read < 100_000 || hit / (hit + read) >= 0.9) return [];
      return [{ ruleId: this.id, dimension: this.dimension, severity: 'MEDIUM', title: `Cache hit ratio ${((hit / (hit + read)) * 100).toFixed(1)}%`, detail: 'A large share of reads miss shared_buffers (they may still hit the OS cache).', evidenceIds: [d.id], facts: { blks_hit: hit, blks_read: read }, candidateActions: [] }];
    },
  },
  {
    id: 'PG-DISK-SPACE',
    dimension: 'Storage',
    description: 'Filesystem holding the data directory above 85% (HIGH) / 95% (CRITICAL).',
    evaluate(ev) {
      const h = ev.first('host');
      if (!h || h.data.unavailable || !h.data.disk) return [];
      const u = h.data.disk.usedPct;
      if (u < 85) return [];
      return [{ ruleId: this.id, dimension: this.dimension, severity: u >= 95 ? 'CRITICAL' : 'HIGH', title: `Data filesystem ${u}% used`, detail: `${fmtBytes(h.data.disk.freeBytes)} free of ${fmtBytes(h.data.disk.totalBytes)} at ${h.data.disk.path}.`, evidenceIds: [h.id], facts: h.data.disk, candidateActions: [] }];
    },
  },
  {
    id: 'PG-SLOT-RETENTION',
    dimension: 'Replication',
    description: 'Inactive replication slot retaining > 1 GB of WAL.',
    evaluate(ev) {
      const r = ev.first('replication');
      if (!r) return [];
      return (r.data.slots as any[]).filter((s) => !s.active && num(s.retained_bytes) > 2 ** 30).map((s) => ({
        ruleId: this.id, dimension: this.dimension, severity: 'HIGH' as Severity, object: s.slot_name,
        title: `Inactive slot ${s.slot_name} retains ${fmtBytes(num(s.retained_bytes))} of WAL`, detail: 'WAL accumulates until the slot is consumed or dropped; can fill the disk.', evidenceIds: [r.id], facts: s, candidateActions: [],
      }));
    },
  },
];
