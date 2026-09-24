// Explainable health score.
//   dimension score = max(0, 100 - sum(penalty[severity] of its findings))
//   penalty: CRITICAL 50, HIGH 25, MEDIUM 10, LOW 3, INFO 0
//   A dimension is UNKNOWN when no collector covering it produced evidence. UNKNOWN is never counted as healthy.
//   Replication with no replicas/slots and not in recovery is NOT_CONFIGURED (not scored).
//   overall = mean of scored dimensions; status CRITICAL if any CRITICAL finding or overall < 50,
//   WARNING if any HIGH finding or overall < 80, else HEALTHY. Coverage is always shown next to the number.
import { DIMENSIONS, type CollectorRun, type Dimension, type EvidenceIndex, type Finding, type Severity } from '../core/types.ts';

export const PENALTY: Record<Severity, number> = { CRITICAL: 50, HIGH: 25, MEDIUM: 10, LOW: 3, INFO: 0 };

// Dimensions that cannot be fully observed from inside the database engine.
const PARTIAL_NOTES: Partial<Record<Dimension, string>> = {
  Backups: 'Only WAL archiving is visible from PostgreSQL. Whether base backups exist, succeed, and restore is UNKNOWN.',
  Storage: 'Filesystem metrics come from the local host only; database sizes from pg_database_size().',
};

const ORACLE_NOTES: Partial<Record<Dimension, string>> = {
  Backups: 'RMAN history from the control file (V$RMAN_BACKUP_JOB_DETAILS). Backups outside RMAN and restore capability are UNKNOWN until a restore test is recorded.',
  Storage: 'Tablespaces from DBA_TABLESPACE_USAGE_METRICS and the Fast Recovery Area; host filesystem only for a local instance.',
};

const noteFor = (d: Dimension, ev: EvidenceIndex) => (ev.first('wal_archiving') ? PARTIAL_NOTES[d] : ev.first('statistics') ? ORACLE_NOTES[d] : undefined);

export interface DimensionHealth {
  dimension: Dimension;
  status: 'SCORED' | 'UNKNOWN' | 'NOT_CONFIGURED';
  score: number | null;
  penalties: { findingId: string; ruleId: string; severity: Severity; penalty: number; title: string }[];
  collectors: { id: string; status: string }[];
  coverageNote?: string;
}

export function computeHealth(runs: CollectorRun[], findings: Finding[], ev: EvidenceIndex, rules: { id: string; dimension: string; description: string }[]) {
  const dims: DimensionHealth[] = DIMENSIONS.map((d) => {
    const covering = runs.filter((r) => r.dimensions.includes(d));
    const ok = covering.filter((r) => r.status === 'ok' && r.evidenceIds.length);
    const collectors = covering.map((r) => ({ id: r.collector, status: r.status }));
    if (!ok.length) return { dimension: d, status: 'UNKNOWN', score: null, penalties: [], collectors, coverageNote: 'No collector produced evidence for this dimension.' };
    if (d === 'Replication') {
      const r = ev.first('replication')?.data;
      // Adapters either report `configured` explicitly (Oracle Data Guard) or the PostgreSQL replicas/slots shape.
      if (r && (r.configured === false || (r.configured === undefined && !r.in_recovery && r.replicas?.length === 0 && r.slots?.length === 0)))
        return { dimension: d, status: 'NOT_CONFIGURED', score: null, penalties: [], collectors, coverageNote: 'Standalone instance: no replicas, no replication slots, not a standby. High availability is not in place.' };
    }
    const penalties = findings.filter((f) => f.dimension === d).map((f) => ({ findingId: f.id, ruleId: f.ruleId, severity: f.severity, penalty: PENALTY[f.severity], title: f.title }));
    return { dimension: d, status: 'SCORED', score: Math.max(0, 100 - penalties.reduce((s, p) => s + p.penalty, 0)), penalties, collectors, coverageNote: noteFor(d, ev) };
  });
  const scored = dims.filter((d) => d.status === 'SCORED');
  const overall = scored.length ? Math.round(scored.reduce((s, d) => s + d.score!, 0) / scored.length) : null;
  const status =
    overall === null ? 'UNKNOWN'
    : findings.some((f) => f.severity === 'CRITICAL') || overall < 50 ? 'CRITICAL'
    : findings.some((f) => f.severity === 'HIGH') || overall < 80 ? 'WARNING'
    : 'HEALTHY';
  return {
    overall,
    status,
    coverage: { scored: scored.length, total: DIMENSIONS.length, unknown: dims.filter((d) => d.status === 'UNKNOWN').map((d) => d.dimension), notConfigured: dims.filter((d) => d.status === 'NOT_CONFIGURED').map((d) => d.dimension) },
    formula: 'dimension = max(0, 100 - Σ penalty); penalty CRITICAL 50 · HIGH 25 · MEDIUM 10 · LOW 3 · INFO 0; overall = mean(scored dimensions); UNKNOWN and NOT_CONFIGURED are excluded and shown, never assumed healthy.',
    dimensions: dims,
    rulesEvaluated: rules,
  };
}
