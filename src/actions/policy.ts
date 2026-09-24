// Policy engine. Deterministic, explainable, evaluated at proposal time AND again right before execution.
//
// Autonomy x risk matrix (Build Day):
//   level 0 OBSERVE / 1 ANALYZE     -> every execution DENIED
//   level 2 RECOMMEND               -> SAFE/LOW: REQUIRES_APPROVAL   MEDIUM+: DENIED (recommendation only, manual)
//   level 3 SAFE_EXECUTION          -> SAFE/LOW: AUTO                MEDIUM+: DENIED
//   level 4 APPROVED_EXECUTION      -> SAFE/LOW: AUTO                MEDIUM/HIGH: REQUIRES_APPROVAL
//   CRITICAL risk or destructive    -> always DENIED (needs two-person approval + extra controls: not built)
// Independent gates: global kill switch, exec identity capability, action supports the engine.
import type { ActionDef } from './catalog.ts';
import type { PermissionReport, Target } from '../core/types.ts';
import { AUTONOMY_NAMES } from '../core/types.ts';

export type Decision = 'AUTO' | 'REQUIRES_APPROVAL' | 'DENIED';

export interface PolicyResult {
  decision: Decision;
  autonomy: string;
  risk: string;
  reasons: string[];
  gates: { id: string; ok: boolean; detail: string }[];
}

export function evaluatePolicy(def: ActionDef, params: Record<string, any>, target: Target, exec: PermissionReport | null, killSwitchEngaged: boolean): PolicyResult {
  const level = target.autonomy_level;
  const lowRisk = def.risk === 'SAFE' || def.risk === 'LOW';
  let decision: Decision;
  let matrix: string;
  if (def.risk === 'CRITICAL' || def.destructive) {
    decision = 'DENIED';
    matrix = 'CRITICAL or destructive actions are never executed by the platform in this version.';
  } else if (level <= 1) {
    decision = 'DENIED';
    matrix = `Autonomy ${AUTONOMY_NAMES[level]} does not allow any execution.`;
  } else if (level === 2) {
    decision = lowRisk ? 'REQUIRES_APPROVAL' : 'DENIED';
    matrix = lowRisk ? 'RECOMMEND: low-risk actions may run only after human approval.' : `RECOMMEND: ${def.risk} risk actions are recommendation-only (manual execution by a DBA).`;
  } else if (level === 3) {
    decision = lowRisk ? 'AUTO' : 'DENIED';
    matrix = lowRisk ? 'SAFE_EXECUTION: low-risk actions run automatically (still revalidated, verified and audited).' : `SAFE_EXECUTION: ${def.risk} risk requires autonomy APPROVED_EXECUTION.`;
  } else {
    decision = lowRisk ? 'AUTO' : 'REQUIRES_APPROVAL';
    matrix = lowRisk ? 'APPROVED_EXECUTION: low-risk actions run automatically.' : `APPROVED_EXECUTION: ${def.risk} risk requires human approval.`;
  }

  const capability = def.requiredCapability(params);
  const hasCapability = capability.startsWith('OWNER:') ? false : Boolean(exec?.capabilities.includes(capability));
  const gates = [
    { id: 'kill_switch', ok: !killSwitchEngaged, detail: killSwitchEngaged ? 'EMERGENCY STOP engaged: no executions allowed.' : 'Kill switch not engaged.' },
    { id: 'engine', ok: def.engines.includes(target.engine), detail: `Action supports: ${def.engines.join(', ')}.` },
    { id: 'exec_identity', ok: exec?.verdict === 'OK', detail: exec ? `Exec identity ${exec.user} verdict ${exec.verdict}.` : 'Exec identity not validated.' },
    {
      id: 'capability', ok: hasCapability,
      detail: hasCapability ? `Exec identity holds ${capability}.` : `Exec identity lacks ${capability}${capability.startsWith('OWNER:') ? ' (least privilege: the platform identity never owns business tables)' : ''}. Manual execution by an authorized DBA required.`,
    },
  ];
  const reasons = [matrix];
  const failed = gates.filter((g) => !g.ok);
  if (failed.length && decision !== 'DENIED') {
    // A failed kill switch gate still allows the plan to be approved; execution re-checks it.
    const blocking = failed.filter((g) => g.id !== 'kill_switch');
    if (blocking.length) decision = 'DENIED';
  }
  failed.forEach((g) => reasons.push(g.detail));
  return { decision, autonomy: `${level} ${AUTONOMY_NAMES[level]}`, risk: def.risk, reasons, gates };
}
