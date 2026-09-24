// Business report for a change: measured facts + arithmetic derived from them + (optional) business assumptions.
// Measured values, derived values and assumptions are kept separate so the PDF never presents an assumption as a fact.
import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pj } from '../core/store.ts';
import { newId } from '../core/util.ts';
import { getChange } from '../actions/changes.ts';
import { HttpError, type Platform } from '../platform.ts';

const run = promisify(execFile);
const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean) as string[];

export interface Assumptions {
  runsPerDay: number | null; // executions of the report per day (business input)
  costPerUserHourUsd: number | null; // cost of one user-hour of waiting (business input)
  providedBy: string;
}

export function parseAssumptions(q: URLSearchParams | Record<string, unknown>, providedBy: string): Assumptions {
  const get = (k: string) => (q instanceof URLSearchParams ? q.get(k) : (q[k] as string | undefined));
  const num = (k: string, max: number) => {
    const v = get(k);
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new HttpError(400, `Invalid ${k}`);
    return n;
  };
  return { runsPerDay: num('runsPerDay', 100_000_000), costPerUserHourUsd: num('costPerUserHourUsd', 100_000), providedBy };
}

export function reportData(p: Platform, changeId: string) {
  const c = getChange(p, changeId);
  if (!c.verification || !c.baseline || !c.after) throw new HttpError(409, 'The change has no post-change verification yet; a report needs measured before/after data.');
  // Oracle step 1 only validates pending statistics in an isolated session: the application saw no change yet.
  if (c.action_id === 'gather_pending_stats') throw new HttpError(409, 'Pending statistics are not visible to the application yet; generate the business report from the publish_pending_stats change.');
  const target = p.target(c.target_id);
  const finding = c.finding_id ? p.store.get('SELECT * FROM findings WHERE id = ?', c.finding_id) : undefined;
  const analysisRow = c.analysis_id ? p.store.get('SELECT * FROM analyses WHERE id = ?', c.analysis_id) : undefined;
  const analysis = analysisRow ? pj<any>(analysisRow.output) : null;
  const item = analysis?.analyses.find((a: any) => a.finding_id === c.finding_id) ?? null;
  const probes = (c.baseline.probes as any[]).map((b) => {
    const a = (c.after.probes as any[]).find((x) => x.probeId === b.probeId);
    if (!a) return null;
    const worst = (pr: any) => Math.max(...pr.nodes.map((n: any) => n.misestimate), 1);
    return {
      id: b.probeId, name: b.name, sloMs: b.sloMs,
      before: { medianMs: b.medianMs, runsMs: b.runsMs, plan: b.planShape, worstMisestimate: worst(b) },
      after: { medianMs: a.medianMs, runsMs: a.runsMs, plan: a.planShape, worstMisestimate: worst(a) },
    };
  }).filter(Boolean);
  return {
    generatedAt: new Date().toISOString(),
    change: {
      id: c.id, number: c.number, actionId: c.action_id, action: c.plan.action, command: c.plan.command, risk: c.risk, reversible: c.plan.reversible, rollback: c.plan.rollback,
      status: c.status, requestedBy: c.requested_by, approvedBy: c.decided_by, approvedAt: c.decided_at, executedAt: c.executed_at,
      identity: c.plan.identity, lockImpact: c.plan.lock_impact, verification: c.verification, steps: c.result?.steps ?? [],
    },
    target: { name: target.name, engine: target.engine, version: target.server_version, database: target.database },
    finding: finding ? { title: finding.title, detail: finding.detail, severity: finding.severity } : null,
    analysis: analysis ? { mode: analysis.mode, model: analysisRow?.model, rootCause: analysis.root_cause_hypothesis, what: item?.what, why: item?.why, impact: item?.impact } : null,
    probes,
    audit: p.audit.list(100, c.id).reverse().map((e: any) => ({ seq: e.seq, ts: e.ts, actor: e.actor, type: e.event_type, hash: e.hash })),
    auditChain: p.audit.verify(),
  };
}

export function edgePath(): string | null {
  return EDGE_CANDIDATES.find((x) => existsSync(x)) ?? null;
}

// Prints the report page with headless Edge. The page is served by this same process on loopback.
export async function renderPdf(pageUrl: string): Promise<Buffer> {
  const edge = edgePath();
  if (!edge) throw new HttpError(501, 'PDF rendering needs Microsoft Edge (set EDGE_PATH). Use the printable page instead.');
  const id = newId('report');
  const out = join(tmpdir(), `${id}.pdf`);
  // Isolated throwaway profile: an Edge window the user already has open must not capture the headless run.
  const profile = join(tmpdir(), `${id}-profile`);
  try {
    await run(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--no-pdf-header-footer', '--virtual-time-budget=8000', `--print-to-pdf=${out}`, pageUrl], { timeout: 45_000 });
    // On Windows the launcher process can exit before its child finishes writing: wait for a complete, stable file.
    const deadline = Date.now() + 30_000;
    let last = -1;
    while (Date.now() < deadline) {
      const size = existsSync(out) ? statSync(out).size : -1;
      if (size > 0 && size === last) {
        const pdf = await readFile(out);
        if (pdf.subarray(-1024).includes('%%EOF')) return pdf;
      }
      last = size;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new HttpError(502, 'Edge did not produce the PDF in time. Use the printable view instead.');
  } finally {
    await rm(out, { force: true });
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
