// Deterministic Oracle rules. A finding exists only if a rule fires on collected evidence; every finding carries
// the evidence ids and the exact facts it used. Oracle dictionary columns arrive upper-case.
import type { Evidence, EvidenceIndex, FindingDraft, Rule, Severity } from '../../core/types.ts';
import type { OraProbeResult } from './probes.ts';

const num = (v: unknown) => Number(v ?? 0);
const gb = (b: number) => `${(b / 2 ** 30).toFixed(1)} GB`;
const rel = (owner: string, table: string) => `${owner.toLowerCase()}.${table.toLowerCase()}`;
const published = (ev: EvidenceIndex) => ev.byCollector('probes').filter((p) => !(p.data as OraProbeResult).pendingStatistics);
const withPending = (ev: EvidenceIndex) => ev.byCollector('probes').filter((p) => (p.data as OraProbeResult).pendingStatistics);
const probesHitting = (probes: Evidence[], relation: string, min: number) => probes.filter((p) => (p.data as OraProbeResult).nodes.some((n) => n.relation === relation && n.misestimate >= min));
const worstOn = (p: OraProbeResult, relation?: string) => Math.max(1, ...p.nodes.filter((n) => !relation || n.relation === relation).map((n) => n.misestimate));

export const oracleRules: Rule[] = [
  {
    id: 'ORA-STATS-STALE',
    dimension: 'Performance',
    description: 'DBA_TAB_STATISTICS.STALE_STATS = YES (modifications exceed the STALE_PERCENT preference) and no pending statistics exist.',
    evaluate(ev) {
      const st = ev.first('statistics');
      if (!st) return [];
      const autotask = ev.first('autotask');
      const autoOff = (autotask?.data as any[] | undefined)?.some((r) => r.CLIENT_NAME === 'auto optimizer stats collection' && r.STATUS !== 'ENABLED');
      const out: FindingDraft[] = [];
      for (const t of st.data as any[]) {
        if (t.STALE_STATS !== 'YES' || num(t.PENDING_COUNT) > 0 || t.STATTYPE_LOCKED) continue;
        const r = rel(t.OWNER, t.TABLE_NAME);
        const mods = num(t.INSERTS) + num(t.UPDATES) + num(t.DELETES);
        const hit = probesHitting(published(ev), r, 100);
        const severity: Severity = hit.length || autoOff ? 'HIGH' : 'MEDIUM';
        out.push({
          ruleId: this.id, dimension: this.dimension, severity, object: r,
          title: `Stale optimizer statistics on ${r}`,
          detail: `${mods.toLocaleString('en-US')} rows modified since statistics were gathered (${Math.round((mods / Math.max(num(t.NUM_ROWS), 1)) * 100)}% of NUM_ROWS=${num(t.NUM_ROWS).toLocaleString('en-US')}; STALE_PERCENT=${t.STALE_PERCENT}). ` +
            (autoOff ? 'The automatic optimizer statistics task is disabled. ' : 'The automatic statistics task only runs in the maintenance window. ') +
            (hit.length ? 'A registered critical query misestimates rows on this table.' : ''),
          evidenceIds: [st.id, ...(autotask ? [autotask.id] : []), ...hit.map((p) => p.id)],
          facts: { num_rows_at_last_gather: num(t.NUM_ROWS), inserts: num(t.INSERTS), updates: num(t.UPDATES), deletes: num(t.DELETES), last_analyzed: t.LAST_ANALYZED, stale_percent: t.STALE_PERCENT, publish_pref: t.PUBLISH_PREF, auto_stats_task_enabled: !autoOff },
          candidateActions: [{ actionId: 'gather_pending_stats', params: { schema: t.OWNER.toLowerCase(), table: t.TABLE_NAME.toLowerCase() } }],
        });
      }
      return out;
    },
  },
  {
    id: 'ORA-PENDING-STATS',
    dimension: 'Performance',
    description: 'Pending statistics exist; they are evaluated with the registered probes in an isolated session (optimizer_use_pending_statistics=TRUE).',
    evaluate(ev) {
      const st = ev.first('statistics');
      if (!st) return [];
      const out: FindingDraft[] = [];
      for (const t of st.data as any[]) {
        if (num(t.PENDING_COUNT) === 0) continue;
        const r = rel(t.OWNER, t.TABLE_NAME);
        const pend = withPending(ev).find((p) => (p.data as OraProbeResult).nodes.some((n) => n.relation === r));
        const pub = pend && published(ev).find((p) => (p.data as OraProbeResult).probeId === (pend.data as OraProbeResult).probeId);
        const base = { dimension: this.dimension, ruleId: this.id, object: r };
        if (!pend || !pub) {
          out.push({ ...base, severity: 'LOW', title: `Pending statistics on ${r} not validated`, detail: 'No registered probe covers this table, so the effect of publishing cannot be measured beforehand.', evidenceIds: [st.id], facts: { pending_analyzed: t.PENDING_ANALYZED }, candidateActions: [] });
          continue;
        }
        const pp = pend.data as OraProbeResult, bp = pub.data as OraProbeResult;
        const good = worstOn(pp, r) <= 10 && pp.medianMs <= bp.medianMs * 1.2;
        out.push({
          ...base,
          severity: good ? 'MEDIUM' : 'HIGH',
          title: good ? `Validated pending statistics ready to publish on ${r}` : `Pending statistics on ${r} would not improve the critical query`,
          detail: `Probe "${bp.name}" with the published statistics: median ${bp.medianMs} ms, worst E-Rows/A-Rows ${worstOn(bp, r)}x. ` +
            `Same probe using the pending statistics (isolated session, nobody else affected): median ${pp.medianMs} ms, worst ${worstOn(pp, r)}x.`,
          evidenceIds: [st.id, pub.id, pend.id],
          facts: { published_median_ms: bp.medianMs, pending_median_ms: pp.medianMs, published_worst_misestimate: worstOn(bp, r), pending_worst_misestimate: worstOn(pp, r), published_plan_hash: bp.planHashValue, pending_plan_hash: pp.planHashValue, pending_analyzed: t.PENDING_ANALYZED, published_last_analyzed: t.LAST_ANALYZED },
          candidateActions: good ? [{ actionId: 'publish_pending_stats', params: { schema: t.OWNER.toLowerCase(), table: t.TABLE_NAME.toLowerCase() } }] : [],
        });
      }
      return out;
    },
  },
  {
    id: 'ORA-PLAN-MISESTIMATE',
    dimension: 'Performance',
    description: 'A registered critical query has a plan line whose E-Rows differ from A-Rows (per start) by >= 10x.',
    evaluate(ev) {
      const st = ev.first('statistics');
      const statsOf = (r: string) => (st?.data as any[] | undefined)?.find((t) => rel(t.OWNER, t.TABLE_NAME) === r);
      return published(ev).flatMap((p): FindingDraft[] => {
        const r = p.data as OraProbeResult;
        if (!r.worst || r.worst.misestimate < 10) return [];
        const candidates = r.nodes.filter((n) => n.misestimate >= 10 && n.relation).flatMap((n) => {
          const s = statsOf(n.relation!);
          if (!s) return [];
          const [schema, table] = n.relation!.split('.');
          if (num(s.PENDING_COUNT) > 0) return [{ actionId: 'publish_pending_stats', params: { schema, table } }];
          if (s.STALE_STATS === 'YES' && !s.STATTYPE_LOCKED) return [{ actionId: 'gather_pending_stats', params: { schema, table } }];
          return [];
        }).filter((a, i, arr) => arr.findIndex((b) => b.params.table === a.params.table) === i);
        return [{
          ruleId: this.id, dimension: this.dimension, severity: r.worst.misestimate >= 100 ? 'HIGH' : 'MEDIUM', object: r.worst.relation ?? undefined,
          title: `E-Rows/A-Rows misestimate ${r.worst.misestimate.toLocaleString('en-US')}x in critical query "${r.name}"`,
          detail: `${r.worst.node} on ${r.worst.relation}: E-Rows ${r.worst.estRows.toLocaleString('en-US')}, A-Rows ${r.worst.actualRows.toLocaleString('en-US')}${r.worst.loops > 1 ? ` per start (${r.worst.loops} starts)` : ''}. ` +
            `Median ${r.medianMs} ms over ${r.runsMs.length} fresh hard parses (SLO ${r.sloMs} ms${r.medianMs > r.sloMs ? ', breached' : ''}). SQL_ID ${r.sqlId}, plan hash ${r.planHashValue}.`,
          evidenceIds: [p.id, ...(st ? [st.id] : [])],
          facts: { probe: r.probeId, sql_id: r.sqlId, plan_hash_value: r.planHashValue, adaptive_plan_resolved: r.adaptivePlanResolved, reoptimizable: r.reoptimizable, worst_line: r.worst, median_ms: r.medianMs, runs_ms: r.runsMs, slo_ms: r.sloMs, plan: r.planShape },
          candidateActions: candidates,
        }];
      });
    },
  },
  {
    id: 'ORA-STATS-LOCKED',
    dimension: 'Maintenance',
    description: 'Statistics are locked (STATTYPE_LOCKED) on a stale table: neither the auto task nor a normal gather will refresh them.',
    evaluate(ev) {
      const st = ev.first('statistics');
      return ((st?.data as any[]) ?? []).filter((t) => t.STATTYPE_LOCKED && t.STALE_STATS === 'YES').map((t) => ({
        ruleId: this.id, dimension: this.dimension, severity: 'MEDIUM' as Severity, object: rel(t.OWNER, t.TABLE_NAME),
        title: `Locked and stale statistics on ${rel(t.OWNER, t.TABLE_NAME)}`, detail: `STATTYPE_LOCKED=${t.STATTYPE_LOCKED}. Unlocking is a DBA decision (often locked on purpose after a bulk-load runbook).`,
        evidenceIds: [st!.id], facts: { stattype_locked: t.STATTYPE_LOCKED, last_analyzed: t.LAST_ANALYZED }, candidateActions: [],
      }));
    },
  },
  {
    id: 'ORA-NOARCHIVELOG',
    dimension: 'Backups',
    description: 'Database in NOARCHIVELOG mode: no point-in-time recovery and no online backups.',
    evaluate(ev) {
      const i = ev.first('instance');
      if (!i || i.data.LOG_MODE !== 'NOARCHIVELOG') return [];
      return [{ ruleId: this.id, dimension: this.dimension, severity: 'HIGH', title: 'Database in NOARCHIVELOG mode', detail: 'Recovery is limited to the last consistent (offline) backup; changes since then are lost. Online RMAN backups and point-in-time recovery are not possible.', evidenceIds: [i.id], facts: { log_mode: i.data.LOG_MODE, force_logging: i.data.FORCE_LOGGING, flashback_on: i.data.FLASHBACK_ON }, candidateActions: [] }];
    },
  },
  {
    id: 'ORA-RMAN-BACKUP',
    dimension: 'Backups',
    description: 'No successful RMAN database backup in the control file history for 30 days, or failures newer than the last success.',
    evaluate(ev) {
      const b = ev.first('backups');
      if (!b) return [];
      const rows = b.data as any[];
      const dbRows = rows.filter((r) => /^DB /.test(String(r.INPUT_TYPE)));
      const lastSuccess = dbRows.map((r) => r.LAST_SUCCESS).filter(Boolean).map((d) => new Date(d)).sort((a, c) => c.getTime() - a.getTime())[0];
      const lastFailure = dbRows.filter((r) => /FAILED|ERRORS/.test(String(r.STATUS))).map((r) => new Date(r.LAST_END)).sort((a, c) => c.getTime() - a.getTime())[0];
      if (!lastSuccess)
        return [{ ruleId: this.id, dimension: this.dimension, severity: 'HIGH', title: 'No successful RMAN database backup in 30 days', detail: 'V$RMAN_BACKUP_JOB_DETAILS has no completed DB FULL/DB INCR job. Backups taken outside RMAN (storage snapshots, Data Pump) are not visible here and remain UNKNOWN.', evidenceIds: [b.id], facts: { jobs: rows }, candidateActions: [] }];
      if (lastFailure && lastFailure > lastSuccess)
        return [{ ruleId: this.id, dimension: this.dimension, severity: 'HIGH', title: 'Latest RMAN backup job failed', detail: `Last failure ${lastFailure.toISOString()} is newer than the last success ${lastSuccess.toISOString()}.`, evidenceIds: [b.id], facts: { jobs: rows }, candidateActions: [] }];
      return [];
    },
  },
  {
    id: 'ORA-FRA-USAGE',
    dimension: 'Storage',
    description: 'Fast Recovery Area non-reclaimable usage above 85% (archiver hangs when it fills).',
    evaluate(ev) {
      const f = ev.first('recovery_area');
      if (!f || f.data.configured === false || !num(f.data.SPACE_LIMIT)) return [];
      const pct = (num(f.data.SPACE_USED) - num(f.data.SPACE_RECLAIMABLE)) / num(f.data.SPACE_LIMIT);
      if (pct < 0.85) return [];
      return [{ ruleId: this.id, dimension: this.dimension, severity: pct >= 0.95 ? 'CRITICAL' : 'HIGH', title: `Fast Recovery Area ${Math.round(pct * 100)}% used (non-reclaimable)`, detail: `${gb(num(f.data.SPACE_USED))} used, ${gb(num(f.data.SPACE_RECLAIMABLE))} reclaimable, limit ${gb(num(f.data.SPACE_LIMIT))}.`, evidenceIds: [f.id], facts: f.data, candidateActions: [] }];
    },
  },
  {
    id: 'ORA-TABLESPACE-USAGE',
    dimension: 'Storage',
    description: 'Permanent tablespace above 85% (HIGH) / 95% (CRITICAL) of its maximum size, autoextend included.',
    evaluate(ev) {
      const t = ev.first('tablespaces');
      return ((t?.data as any[]) ?? []).filter((r) => r.CONTENTS === 'PERMANENT' && num(r.USED_PERCENT) >= 85).map((r) => ({
        ruleId: this.id, dimension: this.dimension, severity: (num(r.USED_PERCENT) >= 95 ? 'CRITICAL' : 'HIGH') as Severity, object: r.TABLESPACE_NAME,
        title: `Tablespace ${r.TABLESPACE_NAME} ${r.USED_PERCENT}% used`, detail: `${gb(num(r.USED_BYTES))} of ${gb(num(r.MAX_BYTES))} (maximum size including autoextend).`, evidenceIds: [t!.id], facts: r, candidateActions: [],
      }));
    },
  },
  {
    id: 'ORA-BLOCKING',
    dimension: 'Availability',
    description: 'Sessions waiting on another session (V$SESSION.BLOCKING_SESSION).',
    evaluate(ev) {
      const b = ev.first('blocking');
      const rows = (b?.data as any[]) ?? [];
      if (!rows.length) return [];
      const maxWait = Math.max(...rows.map((r) => num(r.WAIT_S)));
      return [{ ruleId: this.id, dimension: this.dimension, severity: maxWait > 300 ? 'CRITICAL' : 'HIGH', title: `${rows.length} blocked session(s), longest wait ${maxWait} s`, detail: `Blockers: ${[...new Set(rows.map((r) => r.BLOCKING_SESSION))].join(', ')}. Events: ${[...new Set(rows.map((r) => r.EVENT))].join(', ')}. Killing a session is a HIGH-risk decision for a DBA, not an automatic action.`, evidenceIds: [b!.id], facts: { sessions: rows }, candidateActions: [] }];
    },
  },
  {
    id: 'ORA-RESOURCE-LIMITS',
    dimension: 'Availability',
    description: 'PROCESSES or SESSIONS current utilization above 80% of the limit.',
    evaluate(ev) {
      const s = ev.first('sessions');
      return ((s?.data.limits as any[]) ?? []).filter((r) => /^\d+$/.test(String(r.LIMIT_VALUE)) && num(r.CURRENT_UTILIZATION) / num(r.LIMIT_VALUE) >= 0.8).map((r) => ({
        ruleId: this.id, dimension: this.dimension, severity: 'HIGH' as Severity, object: r.RESOURCE_NAME,
        title: `${r.RESOURCE_NAME} at ${Math.round((num(r.CURRENT_UTILIZATION) / num(r.LIMIT_VALUE)) * 100)}% of limit`, detail: `${r.CURRENT_UTILIZATION} of ${r.LIMIT_VALUE} (max seen ${r.MAX_UTILIZATION}).`, evidenceIds: [s!.id], facts: r, candidateActions: [],
      }));
    },
  },
  {
    id: 'ORA-AUTOTASK-STATS',
    dimension: 'Maintenance',
    description: 'Automatic optimizer statistics collection task is disabled.',
    evaluate(ev) {
      const a = ev.first('autotask');
      const row = ((a?.data as any[]) ?? []).find((r) => r.CLIENT_NAME === 'auto optimizer stats collection');
      if (!row || row.STATUS === 'ENABLED') return [];
      return [{ ruleId: this.id, dimension: this.dimension, severity: 'MEDIUM', title: 'Automatic optimizer statistics collection disabled', detail: 'Statistics freshness depends entirely on manual jobs.', evidenceIds: [a!.id], facts: row, candidateActions: [] }];
    },
  },
  {
    id: 'ORA-DEFAULT-PASSWORDS',
    dimension: 'Security',
    description: 'OPEN accounts still using a default password (DBA_USERS_WITH_DEFPWD).',
    evaluate(ev) {
      const s = ev.first('security');
      const users = (s?.data.defaultPasswordOpen as string[]) ?? [];
      if (!users.length) return [];
      return [{ ruleId: this.id, dimension: this.dimension, severity: 'HIGH', title: `${users.length} open account(s) with default password`, detail: `Accounts: ${users.join(', ')}.`, evidenceIds: [s!.id], facts: { accounts: users }, candidateActions: [] }];
    },
  },
  {
    id: 'ORA-PACK-ACCESS',
    dimension: 'Configuration',
    description: 'CONTROL_MANAGEMENT_PACK_ACCESS enables Diagnostics/Tuning Pack features: verify licensing. This platform never queries AWR/ASH.',
    evaluate(ev) {
      const p = ev.first('parameters');
      const v = String(p?.data.control_management_pack_access?.value ?? '');
      if (!/DIAGNOSTIC|TUNING/i.test(v)) return [];
      return [{ ruleId: this.id, dimension: this.dimension, severity: 'INFO', title: `Management packs enabled: ${v}`, detail: 'Diagnostics/Tuning Pack features (AWR, ASH, SQL Tuning Advisor) are enabled at the instance level. Confirm they are licensed. The platform itself uses only V$ and DBA_ views available in every edition.', evidenceIds: [p!.id], facts: { control_management_pack_access: v }, candidateActions: [] }];
    },
  },
];
