// Change management: PROPOSED -> PENDING_APPROVAL -> APPROVED -> EXECUTING -> COMPLETED | FAILED
//                    side exits: BLOCKED (policy), REJECTED, CANCELLED, EXPIRED (TTL or preconditions changed)
// Every transition is audited. Execution = kill switch -> expiry -> change lock -> revalidate (TOCTOU) -> policy
//                                        -> baseline -> execute (exec identity) -> after -> verify -> release lock.
import { j, pj } from '../core/store.ts';
import { canonicalJson, newId, nowIso, sha256 } from '../core/util.ts';
import type { PreconditionResult } from '../core/types.ts';
import { HttpError, type Identity, type Platform } from '../platform.ts';
import { getAction, validateParams } from './catalog.ts';
import { evaluatePolicy } from './policy.ts';

const APPROVAL_TTL_MS = Number(process.env.APPROVAL_TTL_MINUTES ?? 15) * 60_000;
const OPEN = ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING'];

const fingerprintOf = (pre: PreconditionResult) => sha256(canonicalJson(pre.state));

export function getChange(p: Platform, id: string) {
  const c = p.store.get('SELECT * FROM change_plans WHERE id = ?', id);
  if (!c) throw new HttpError(404, `Change ${id} not found`);
  const parse = ['params', 'policy', 'plan', 'preconditions', 'baseline', 'after', 'verification', 'result'];
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, parse.includes(k) ? pj(v) : v])) as any;
}

export function listChanges(p: Platform, targetId?: string) {
  const rows = targetId ? p.store.all('SELECT id FROM change_plans WHERE target_id = ? ORDER BY number DESC', targetId) : p.store.all('SELECT id FROM change_plans ORDER BY number DESC');
  return rows.map((r) => getChange(p, String(r.id)));
}

export async function proposeChange(p: Platform, input: { targetId: string; assessmentId?: string; findingId?: string; analysisId?: string; actionId: string; params: unknown; rationale?: string }, requestedBy = 'ai-dba-agent') {
  const def = getAction(input.actionId);
  if (!def) throw new HttpError(400, `Unknown action: ${input.actionId}`);
  const v = validateParams(def, input.params);
  if (!v.ok) throw new HttpError(400, `Invalid parameters: ${v.error}`);
  const target = p.target(input.targetId);
  const existing = p.store.get(`SELECT id FROM change_plans WHERE target_id = ? AND action_id = ? AND params = ? AND status IN (${OPEN.map(() => '?').join(',')})`, target.id, def.id, j(v.params), ...OPEN);
  if (existing) return getChange(p, String(existing.id));

  const adapter = p.adapter(target);
  const impl = adapter.action(def.id);
  if (!impl) throw new HttpError(400, `Action ${def.id} not implemented for ${target.engine}`);
  const policy = evaluatePolicy(def, v.params, target, p.execReport(target.id), p.killSwitch().engaged);
  const pre = await impl.preconditions(v.params);
  const estimate = await impl.estimate(v.params);
  const plan = {
    action: def.title, description: def.description, target: `${target.name} (${target.engine} ${target.server_version}) ${v.params.schema}.${v.params.table}`,
    command: impl.buildSql(v.params), identity: target.exec_user, timeouts: { statement_timeout_ms: 60_000, lock_timeout_ms: 3_000 },
    risk: def.risk, reversible: def.reversible, rollback: def.rollback, lock_impact: def.lockImpact, estimate,
    validation: 'Baseline captured immediately before execution; the same metrics are captured after and compared.',
  };
  const status = policy.decision === 'DENIED' ? 'BLOCKED' : 'PENDING_APPROVAL';
  const id = newId('chg');
  const number = Number(p.store.get('SELECT coalesce(max(number), 200) + 1 AS n FROM change_plans')!.n);
  p.store.run(
    `INSERT INTO change_plans(id, number, target_id, assessment_id, finding_id, analysis_id, action_id, params, risk, rationale, policy, plan, preconditions, fingerprint, status, requested_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, number, target.id, input.assessmentId ?? null, input.findingId ?? null, input.analysisId ?? null, def.id, j(v.params), def.risk, input.rationale ?? null, j(policy), j(plan), j(pre), fingerprintOf(pre), status, requestedBy, nowIso(),
  );
  p.audit.write({ actor: requestedBy, type: 'CHANGE_PROPOSED', target: target.id, changeId: id, payload: { number, action: def.id, params: v.params, risk: def.risk, policy: { decision: policy.decision, reasons: policy.reasons }, command: plan.command, preconditions: pre.checks, fingerprint: fingerprintOf(pre), finding_id: input.findingId, analysis_id: input.analysisId } });
  // Low-risk at SAFE_EXECUTION autonomy is auto-approved by policy (still revalidated at execution time).
  if (policy.decision === 'AUTO') return approveInternal(p, id, { id: 'policy-engine', name: 'Policy engine', roles: [] }, 'Auto-approved by policy (autonomy allows low-risk execution).');
  return getChange(p, id);
}

async function approveInternal(p: Platform, id: string, who: Identity, note: string) {
  const c = getChange(p, id);
  const target = p.target(c.target_id);
  const pre = await p.adapter(target).action(c.action_id)!.preconditions(c.params);
  const failed = pre.checks.filter((x) => !x.ok);
  if (failed.length) throw new HttpError(409, `Cannot approve: preconditions not met: ${failed.map((f) => f.description).join('; ')}`);
  const fp = fingerprintOf(pre);
  const expires = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
  p.store.run("UPDATE change_plans SET status = 'APPROVED', decided_by = ?, decided_at = ?, decision_note = ?, preconditions = ?, fingerprint = ?, expires_at = ? WHERE id = ?", who.id, nowIso(), note, j(pre), fp, expires, id);
  p.audit.write({ actor: who.id, type: 'CHANGE_APPROVED', target: target.id, changeId: id, payload: { number: c.number, note, expected_state: pre.state, preconditions: pre.checks, fingerprint: fp, expires_at: expires, evidence: { assessment_id: c.assessment_id, finding_id: c.finding_id, analysis_id: c.analysis_id } } });
  return getChange(p, id);
}

export async function approveChange(p: Platform, id: string, who: Identity, note = '') {
  const c = getChange(p, id);
  if (c.status !== 'PENDING_APPROVAL') throw new HttpError(409, `Change is ${c.status}, not PENDING_APPROVAL`);
  if (c.requested_by === who.id) throw new HttpError(403, 'Separation of duties: the requester cannot approve their own change');
  return approveInternal(p, id, who, note);
}

export function decideChange(p: Platform, id: string, who: Identity, decision: 'REJECTED' | 'CANCELLED', note = '') {
  const c = getChange(p, id);
  const allowed = decision === 'REJECTED' ? ['PENDING_APPROVAL'] : ['PENDING_APPROVAL', 'APPROVED'];
  if (!allowed.includes(c.status)) throw new HttpError(409, `Change is ${c.status}; cannot mark ${decision}`);
  p.store.run('UPDATE change_plans SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?', decision, who.id, nowIso(), note, id);
  p.audit.write({ actor: who.id, type: `CHANGE_${decision}`, target: c.target_id, changeId: id, payload: { number: c.number, note } });
  return getChange(p, id);
}

// "Ask for more evidence": re-collect preconditions and estimate, keep the change pending, record the request.
export async function refreshEvidence(p: Platform, id: string, who: Identity, note = '') {
  const c = getChange(p, id);
  if (c.status !== 'PENDING_APPROVAL') throw new HttpError(409, `Change is ${c.status}`);
  const impl = p.adapter(p.target(c.target_id)).action(c.action_id)!;
  const pre = await impl.preconditions(c.params);
  const plan = { ...c.plan, estimate: await impl.estimate(c.params) };
  p.store.run('UPDATE change_plans SET preconditions = ?, fingerprint = ?, plan = ? WHERE id = ?', j(pre), fingerprintOf(pre), j(plan), id);
  p.audit.write({ actor: who.id, type: 'CHANGE_EVIDENCE_REFRESHED', target: c.target_id, changeId: id, payload: { number: c.number, note, preconditions: pre.checks } });
  return getChange(p, id);
}

export async function executeChange(p: Platform, id: string, who: Identity) {
  const c = getChange(p, id);
  const target = p.target(c.target_id);
  const steps: { step: string; at: string; ok: boolean; detail: unknown }[] = [];
  const step = (s: string, ok: boolean, detail: unknown) => steps.push({ step: s, at: nowIso(), ok, detail });
  const saveResult = (extra: Record<string, unknown>) => p.store.run('UPDATE change_plans SET result = ? WHERE id = ?', j({ steps, ...extra }), id);
  const refuse = (status: string, type: string, message: string, detail: unknown) => {
    step(type, false, detail);
    p.store.run('UPDATE change_plans SET status = ?, error = ? WHERE id = ?', status, message, id);
    saveResult({ outcome: status });
    p.audit.write({ actor: who.id, type, target: target.id, changeId: id, payload: { number: c.number, message, detail } });
    return { ...getChange(p, id), refused: message };
  };

  if (c.status !== 'APPROVED') throw new HttpError(409, `Change is ${c.status}; only APPROVED changes can be executed`);
  const ks = p.killSwitch();
  if (ks.engaged) return refuse('APPROVED', 'EXECUTION_BLOCKED_KILL_SWITCH', 'EMERGENCY STOP is engaged. No executions allowed.', ks);
  if (Date.parse(c.expires_at) < Date.now()) return refuse('EXPIRED', 'APPROVAL_EXPIRED', 'Approval expired (TTL). A new approval is required.', { expires_at: c.expires_at });

  // Change lock: one executing change per target (PRIMARY KEY on target_id makes this atomic).
  try {
    p.store.run('INSERT INTO change_locks(target_id, change_id, acquired_at, holder) VALUES (?,?,?,?)', target.id, id, nowIso(), who.id);
  } catch {
    const holder = p.store.get('SELECT * FROM change_locks WHERE target_id = ?', target.id);
    return refuse('APPROVED', 'EXECUTION_BLOCKED_CHANGE_LOCK', `Another change is executing on this target (${holder?.change_id}).`, holder);
  }
  step('change_lock_acquired', true, { target: target.id });

  const adapter = p.adapter(target);
  const impl = adapter.action(c.action_id)!;
  const def = getAction(c.action_id)!;
  try {
    p.store.run("UPDATE change_plans SET status = 'EXECUTING', error = NULL WHERE id = ?", id);
    p.audit.write({ actor: who.id, type: 'EXECUTION_STARTED', target: target.id, changeId: id, payload: { number: c.number } });

    // TOCTOU: revalidate right before executing.
    const pre = await impl.preconditions(c.params);
    const fp = fingerprintOf(pre);
    const failed = pre.checks.filter((x) => !x.ok);
    const changed = fp !== c.fingerprint;
    step('revalidate_preconditions', !failed.length && !changed, { fingerprint_at_approval: c.fingerprint, fingerprint_now: fp, approved_state: c.preconditions?.state, current_state: pre.state, failed_checks: failed });
    if (failed.length || changed) {
      p.store.run('UPDATE change_plans SET preconditions = ? WHERE id = ?', j(pre), id);
      return refuse('EXPIRED', 'PRECONDITIONS_CHANGED', 'Preconditions changed. Approval expired.', { approved_state: c.preconditions?.state, current_state: pre.state, failed_checks: failed });
    }

    const policy = evaluatePolicy(def, c.params, target, p.execReport(target.id), p.killSwitch().engaged);
    step('policy_recheck', policy.decision !== 'DENIED', policy);
    if (policy.decision === 'DENIED') return refuse('BLOCKED', 'POLICY_DENIED_AT_EXECUTION', 'Policy no longer allows this action.', policy);

    const baseline = await impl.capture(c.params);
    p.store.run('UPDATE change_plans SET baseline = ? WHERE id = ?', j(baseline), id);
    step('baseline_captured', true, { identity: target.ro_user });

    const sql = impl.buildSql(c.params);
    if (sql !== c.plan.command) throw new Error('Generated command differs from the approved command');
    const ex = await adapter.executeAuthorized(sql, { statementTimeoutMs: c.plan.timeouts.statement_timeout_ms, lockTimeoutMs: c.plan.timeouts.lock_timeout_ms });
    p.store.run('UPDATE change_plans SET executed_at = ? WHERE id = ?', nowIso(), id);
    step('executed', true, { command: sql, identity: target.exec_user, server_tag: ex.command, duration_ms: ex.ms });
    p.audit.write({ actor: who.id, type: 'EXECUTED', target: target.id, changeId: id, payload: { number: c.number, command: sql, identity: target.exec_user, server_tag: ex.command, duration_ms: ex.ms } });

    const after = await impl.capture(c.params);
    const verification = impl.verify(baseline, after);
    step('verified', verification.outcome !== 'DEGRADED', { outcome: verification.outcome });
    const status = verification.outcome === 'DEGRADED' ? 'DEGRADED' : 'COMPLETED';
    p.store.run('UPDATE change_plans SET status = ?, after = ?, verification = ? WHERE id = ?', status, j(after), j(verification), id);
    saveResult({ outcome: verification.outcome });
    p.audit.write({ actor: who.id, type: 'VERIFICATION_COMPLETED', target: target.id, changeId: id, payload: { number: c.number, outcome: verification.outcome, summary: verification.summary, checks: verification.checks } });
    if (verification.outcome === 'DEGRADED' || verification.outcome === 'INCONCLUSIVE') {
      await p.notify.alert({
        severity: verification.outcome === 'DEGRADED' ? 'HIGH' : 'MEDIUM', subject: `Change #${c.number} ${verification.outcome}`, target: target.name, engine: target.engine,
        event: `Post-change validation: ${verification.outcome}`, evidence: verification.checks, impact: verification.summary,
        recommendation: def.reversible ? `Rollback available: ${def.rollback}` : `No automated rollback: ${def.rollback}`, action: sql, status: 'NEEDS_DBA_REVIEW',
      });
    }
    return getChange(p, id);
  } catch (e) {
    const msg = (e as Error).message;
    step('error', false, msg);
    p.store.run("UPDATE change_plans SET status = 'FAILED', error = ? WHERE id = ?", msg, id);
    saveResult({ outcome: 'FAILED' });
    p.audit.write({ actor: who.id, type: 'EXECUTION_FAILED', target: target.id, changeId: id, payload: { number: c.number, error: msg } });
    await p.notify.alert({ severity: 'HIGH', subject: `Change #${c.number} FAILED`, target: target.name, engine: target.engine, event: 'Execution failed', evidence: { error: msg, steps }, recommendation: 'Review the error; no automatic retry.', status: 'FAILED' });
    return getChange(p, id);
  } finally {
    p.store.run('DELETE FROM change_locks WHERE target_id = ? AND change_id = ?', target.id, id);
    if (steps.length) saveResult({ outcome: getChange(p, id).verification?.outcome ?? getChange(p, id).status });
  }
}

export function setKillSwitch(p: Platform, who: Identity, engaged: boolean, reason: string, cancelPending: boolean) {
  p.store.setSetting('kill_switch', JSON.stringify({ engaged, by: who.id, at: nowIso(), reason }));
  let cancelled: string[] = [];
  if (engaged && cancelPending) {
    cancelled = p.store.all("SELECT id FROM change_plans WHERE status IN ('PENDING_APPROVAL','APPROVED')").map((r) => String(r.id));
    for (const id of cancelled) p.store.run("UPDATE change_plans SET status = 'CANCELLED', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?", who.id, nowIso(), 'Cancelled by EMERGENCY STOP', id);
  }
  p.audit.write({ actor: who.id, type: engaged ? 'KILL_SWITCH_ENGAGED' : 'KILL_SWITCH_RELEASED', payload: { reason, cancelled_changes: cancelled } });
  return p.killSwitch();
}
