// Registered probes: fixed, human-reviewed SELECTs. EXPLAIN ANALYZE really executes the query, so it is only
// allowed for these probes, only as SELECT/WITH, inside a READ ONLY transaction, with a statement_timeout.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PgConnections } from './connection.ts';
import { median } from '../../core/util.ts';

export interface Probe {
  id: string;
  name: string;
  database: string;
  tables: string[];
  sql: string;
  timeout_ms: number;
  slo_ms: number;
}

export interface PlanNodeSummary {
  node: string;
  relation: string | null;
  estRows: number;
  actualRows: number;
  loops: number;
  misestimate: number; // max(est, actual) / max(min(est, actual), 1), per loop
}

export interface ProbeResult {
  probeId: string;
  name: string;
  runsMs: number[];
  medianMs: number;
  sloMs: number;
  planShape: string[];
  nodes: PlanNodeSummary[];
  worst: PlanNodeSummary | null;
  sharedHit: number;
  sharedRead: number;
}

export function loadProbes(root: string, database: string): Probe[] {
  const all: Probe[] = JSON.parse(readFileSync(join(root, 'config', 'probes.json'), 'utf8')).probes;
  return all.filter((p) => p.database === database);
}

function assertSafeProbe(sql: string): void {
  const s = sql.trim();
  if (!/^(select|with)\b/i.test(s)) throw new Error('Probe policy: only SELECT/WITH statements may be profiled');
  if (s.includes(';')) throw new Error('Probe policy: multiple statements are not allowed');
  if (/\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do)\b/i.test(s))
    throw new Error('Probe policy: data-modifying keywords are not allowed in probes');
}

function walk(n: any, depth: number, shape: string[], nodes: PlanNodeSummary[]): void {
  const est = Number(n['Plan Rows']);
  const act = Number(n['Actual Rows']);
  const rel = n['Relation Name'] ? `${n['Schema'] ?? 'public'}.${n['Relation Name']}` : null;
  const s = {
    node: n['Node Type'],
    relation: rel,
    estRows: est,
    actualRows: act,
    loops: Number(n['Actual Loops']),
    misestimate: Math.round((Math.max(est, act) / Math.max(Math.min(est, act), 1)) * 10) / 10,
  };
  nodes.push(s);
  shape.push(`${'  '.repeat(depth)}${s.node}${rel ? ' on ' + rel : ''}  (est ${est}, actual ${act}${s.loops > 1 ? ` x${s.loops} loops` : ''})`);
  for (const c of n.Plans ?? []) walk(c, depth + 1, shape, nodes);
}

export async function runProbe(conn: PgConnections, probe: Probe, runs = 3): Promise<ProbeResult> {
  assertSafeProbe(probe.sql);
  const runsMs: number[] = [];
  let plan: any;
  for (let i = 0; i < runs; i++) {
    const rows = await conn.ro(`EXPLAIN (ANALYZE, BUFFERS, VERBOSE, TIMING OFF, SUMMARY ON, FORMAT JSON) ${probe.sql}`, [], probe.timeout_ms);
    plan = rows[0]['QUERY PLAN'][0];
    runsMs.push(Math.round(plan['Execution Time'] * 10) / 10);
  }
  const shape: string[] = [];
  const nodes: PlanNodeSummary[] = [];
  walk(plan.Plan, 0, shape, nodes);
  const scans = nodes.filter((n) => n.relation);
  const worst = scans.reduce<PlanNodeSummary | null>((w, n) => (!w || n.misestimate > w.misestimate ? n : w), null);
  return {
    probeId: probe.id,
    name: probe.name,
    runsMs,
    medianMs: median(runsMs),
    sloMs: probe.slo_ms,
    planShape: shape,
    nodes: scans,
    worst,
    sharedHit: Number(plan.Plan['Shared Hit Blocks'] ?? 0),
    sharedRead: Number(plan.Plan['Shared Read Blocks'] ?? 0),
  };
}
