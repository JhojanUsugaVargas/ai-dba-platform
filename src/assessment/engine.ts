// RAW EVIDENCE -> DETERMINISTIC FINDINGS -> SEVERITY -> HEALTH SCORE. No LLM in this module.
import type { Store } from '../core/store.ts';
import { j, pj } from '../core/store.ts';
import type { Audit } from '../core/audit.ts';
import type { CollectorRun, EngineAdapter, Evidence, EvidenceIndex, Finding, Target } from '../core/types.ts';
import { newId, nowIso, withTimeout } from '../core/util.ts';
import { computeHealth } from './score.ts';

const ASSESSMENT_BUDGET_MS = 90_000;

export async function runAssessment(store: Store, audit: Audit, adapter: EngineAdapter, target: Target, actor: string, onProgress?: (msg: string) => void) {
  const id = newId('asm');
  store.run('INSERT INTO assessments(id, target_id, status, started_at, requested_by) VALUES (?,?,?,?,?)', id, target.id, 'RUNNING', nowIso(), actor);
  audit.write({ actor, type: 'ASSESSMENT_STARTED', target: target.id, payload: { assessment_id: id, identity: target.ro_user, mode: 'READ_ONLY' } });

  const started = Date.now();
  const runs: CollectorRun[] = [];
  const evidence: Evidence[] = [];
  for (const c of adapter.collectors()) {
    if (!c.enabled) {
      runs.push({ collector: c.id, status: 'skipped', ms: 0, evidenceIds: [], dimensions: c.dimensions, error: 'disabled by configuration' });
      continue;
    }
    const remaining = ASSESSMENT_BUDGET_MS - (Date.now() - started);
    if (remaining <= 0) {
      runs.push({ collector: c.id, status: 'skipped', ms: 0, evidenceIds: [], dimensions: c.dimensions, error: 'assessment time budget exhausted' });
      continue;
    }
    onProgress?.(`collector:${c.id}`);
    const t0 = Date.now();
    try {
      const drafts = await withTimeout(c.run({ target, budgetMs: Math.min(c.timeoutMs, remaining) }), Math.min(c.timeoutMs, remaining), `collector ${c.id}`);
      const ids: string[] = [];
      for (const d of drafts) {
        const ev: Evidence = { id: newId('ev'), collector: c.id, source: d.source, data: d.data };
        store.run('INSERT INTO evidence(id, assessment_id, collector, source, data, collected_at) VALUES (?,?,?,?,?,?)', ev.id, id, c.id, d.source, j(d.data), nowIso());
        evidence.push(ev);
        ids.push(ev.id);
      }
      runs.push({ collector: c.id, status: 'ok', ms: Date.now() - t0, evidenceIds: ids, dimensions: c.dimensions });
    } catch (e) {
      const msg = (e as Error).message;
      runs.push({ collector: c.id, status: /budget|timeout|canceling statement/i.test(msg) ? 'timeout' : 'error', ms: Date.now() - t0, evidenceIds: [], dimensions: c.dimensions, error: msg });
    }
  }

  onProgress?.('rules');
  const index: EvidenceIndex = {
    byCollector: (cid) => evidence.filter((e) => e.collector === cid),
    first: (cid, source) => evidence.find((e) => e.collector === cid && (!source || e.source === source)),
  };
  const findings: Finding[] = [];
  const ruleErrors: { rule: string; error: string }[] = [];
  for (const rule of adapter.rules()) {
    try {
      for (const f of rule.evaluate(index)) findings.push({ ...f, id: newId('fnd') });
    } catch (e) {
      ruleErrors.push({ rule: rule.id, error: (e as Error).message });
    }
  }
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  for (const f of findings) {
    store.run(
      'INSERT INTO findings(id, assessment_id, rule_id, dimension, severity, title, detail, object, evidence_ids, facts, candidate_actions) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      f.id, id, f.ruleId, f.dimension, f.severity, f.title, f.detail, f.object ?? null, j(f.evidenceIds), j(f.facts), j(f.candidateActions),
    );
  }

  const health = computeHealth(runs, findings, index, adapter.rules().map((r) => ({ id: r.id, dimension: r.dimension, description: r.description })));
  store.run('UPDATE assessments SET status = ?, finished_at = ?, collector_runs = ?, score = ?, error = ? WHERE id = ?', 'COMPLETED', nowIso(), j(runs), j(health), ruleErrors.length ? j(ruleErrors) : null, id);
  audit.write({
    actor, type: 'ASSESSMENT_COMPLETED', target: target.id,
    payload: { assessment_id: id, duration_ms: Date.now() - started, collectors: runs.map((r) => ({ id: r.collector, status: r.status, ms: r.ms })), findings: findings.map((f) => ({ id: f.id, rule: f.ruleId, severity: f.severity, object: f.object })), overall: health.overall },
  });
  return getAssessment(store, id)!;
}

export function getAssessment(store: Store, id: string) {
  const a = store.get('SELECT * FROM assessments WHERE id = ?', id);
  if (!a) return undefined;
  return {
    ...a,
    collector_runs: pj(a.collector_runs),
    score: pj(a.score),
    error: pj(a.error),
    findings: store.all('SELECT * FROM findings WHERE assessment_id = ?', id).map((f) => ({
      ...f, evidence_ids: pj(f.evidence_ids), facts: pj(f.facts), candidate_actions: pj(f.candidate_actions),
    })),
    evidence: store.all('SELECT * FROM evidence WHERE assessment_id = ?', id).map((e) => ({ ...e, data: pj(e.data) })),
  };
}

export function latestAssessment(store: Store, targetId: string) {
  const r = store.get("SELECT id FROM assessments WHERE target_id = ? AND status = 'COMPLETED' ORDER BY started_at DESC LIMIT 1", targetId);
  return r ? getAssessment(store, String(r.id)) : undefined;
}
