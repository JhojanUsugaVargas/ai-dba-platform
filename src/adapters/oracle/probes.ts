// Oracle probes: registered SELECTs run in SET TRANSACTION READ ONLY with GATHER_PLAN_STATISTICS.
// E-Rows vs A-Rows per plan line come from V$SQL_PLAN_STATISTICS_ALL (same data DBMS_XPLAN.DISPLAY_CURSOR
// 'ALLSTATS LAST' prints). Each run gets a unique trailing comment so it is a fresh hard parse with the statistics
// in effect: no cursor sharing and no statistics feedback carried over from an earlier child cursor.
// Result shape matches the PostgreSQL ProbeResult so verification, UI and PDF report are engine-neutral.
import oracledb from 'oracledb';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { median } from '../../core/util.ts';
import type { PlanNodeSummary, ProbeResult } from '../postgres/probes.ts';
import type { OraConnections } from './connection.ts';

export interface OraProbe {
  id: string;
  name: string;
  tables: string[];
  sql: string;
  timeout_ms: number;
  slo_ms: number;
}

export interface OraProbeResult extends ProbeResult {
  sqlId: string;
  planHashValue: number;
  adaptivePlanResolved: string | null;
  reoptimizable: string | null;
  pendingStatistics: boolean;
}

export function loadOraProbes(root: string): OraProbe[] {
  return JSON.parse(readFileSync(join(root, 'config', 'probes.oracle.json'), 'utf8')).probes;
}

function assertSafeProbe(sql: string): void {
  const s = sql.trim();
  if (!/^select\b/i.test(s)) throw new Error('Probe policy: only SELECT statements may be profiled');
  if (s.includes(';')) throw new Error('Probe policy: multiple statements are not allowed');
  const noHints = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (/\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|begin|declare|execute|call|lock|for\s+update)\b/i.test(noHints))
    throw new Error('Probe policy: data-modifying or session-altering keywords are not allowed in probes');
}

async function oneRun(c: oracledb.Connection, sql: string, tag: string) {
  await c.execute('SET TRANSACTION READ ONLY');
  const t0 = performance.now();
  await c.execute(`${sql} /* aidba-probe ${tag} */`, [], { maxRows: 1000 });
  const ms = Math.round((performance.now() - t0) * 10) / 10;
  // The probe is now the session's previous statement.
  const cur = (await c.execute<any>(`SELECT prev_sql_id AS sql_id, prev_child_number AS child FROM v$session WHERE sid = SYS_CONTEXT('USERENV','SID')`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows![0];
  const lines = (await c.execute<any>(
    `SELECT id, parent_id, depth, operation, options, object_owner, object_name, object_type, cardinality, last_starts, last_output_rows
       FROM v$sql_plan_statistics_all WHERE sql_id = :s AND child_number = :c ORDER BY id`,
    { s: cur.SQL_ID, c: cur.CHILD }, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows!;
  const meta = (await c.execute<any>(`SELECT plan_hash_value, is_resolved_adaptive_plan, is_reoptimizable FROM v$sql WHERE sql_id = :s AND child_number = :c`, { s: cur.SQL_ID, c: cur.CHILD }, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows![0] ?? {};
  await c.commit();
  return { ms, sqlId: cur.SQL_ID as string, lines, meta };
}

export async function runOraProbe(conn: OraConnections, probe: OraProbe, opts: { runs?: number; pending?: boolean } = {}): Promise<OraProbeResult> {
  assertSafeProbe(probe.sql);
  const runs = opts.runs ?? 3;
  return conn.roIsolated(async (c) => {
    if (opts.pending) await c.execute('ALTER SESSION SET optimizer_use_pending_statistics = TRUE');
    const results = [];
    for (let i = 0; i < runs; i++) results.push(await oneRun(c, probe.sql, `${Date.now()}-${i}${opts.pending ? '-pending' : ''}`));
    const last = results[results.length - 1];
    const shape: string[] = [];
    const nodes: PlanNodeSummary[] = [];
    for (const l of last.lines) {
      const starts = Number(l.LAST_STARTS ?? 0);
      if (!starts) continue; // inactive adaptive-plan lines / never executed
      const est = Number(l.CARDINALITY ?? 0);
      const actualPerStart = Math.round(Number(l.LAST_OUTPUT_ROWS ?? 0) / starts);
      const op = `${l.OPERATION}${l.OPTIONS ? ' ' + l.OPTIONS : ''}`;
      const obj = l.OBJECT_NAME ? `${String(l.OBJECT_OWNER).toLowerCase()}.${String(l.OBJECT_NAME).toLowerCase()}` : null;
      shape.push(`${'  '.repeat(Number(l.DEPTH ?? 0))}${op}${obj ? ' ' + obj : ''}  (E-Rows ${est}, A-Rows ${actualPerStart}${starts > 1 ? ` x${starts} starts` : ''})`);
      if (l.OPERATION === 'TABLE ACCESS' && obj) {
        nodes.push({ node: op, relation: obj, estRows: est, actualRows: actualPerStart, loops: starts, misestimate: Math.round((Math.max(est, actualPerStart) / Math.max(Math.min(est, actualPerStart), 1)) * 10) / 10 });
      }
    }
    const worst = nodes.reduce<PlanNodeSummary | null>((w, n) => (!w || n.misestimate > w.misestimate ? n : w), null);
    const runsMs = results.map((r) => r.ms);
    return {
      probeId: probe.id,
      name: probe.name,
      runsMs,
      medianMs: median(runsMs),
      sloMs: probe.slo_ms,
      planShape: shape,
      nodes,
      worst,
      sharedHit: 0,
      sharedRead: 0,
      sqlId: last.sqlId,
      planHashValue: Number(last.meta.PLAN_HASH_VALUE ?? 0),
      adaptivePlanResolved: last.meta.IS_RESOLVED_ADAPTIVE_PLAN ?? null,
      reoptimizable: last.meta.IS_REOPTIMIZABLE ?? null,
      pendingStatistics: Boolean(opts.pending),
    };
  }, probe.timeout_ms);
}
