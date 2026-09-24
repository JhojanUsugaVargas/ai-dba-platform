// End-to-end API test of the full demo flow against a running server and a freshly reset lab.
// Usage: node scripts/e2e.ts [--tamper]   (--tamper exercises the TOCTOU refusal path)
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const call = async (method: string, path: string, actor: string, body?: unknown) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-actor': actor }, body: body ? JSON.stringify(body) : undefined });
  const data: any = await r.json();
  return { status: r.status, data };
};
const expect = (cond: unknown, msg: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

const tamper = process.argv.includes('--tamper');
const t = (await call('POST', '/api/targets', 'dba.lead', {})).data;
expect(t.id, `target registered ${t.id}`);
const v = (await call('POST', '/api/targets/' + t.id + '/validate', 'dba.lead')).data;
expect(v.ro.verdict === 'OK' && v.exec.verdict === 'OK', `permissions: ro=${v.ro.verdict} exec=${v.exec.verdict} version=${v.version}`);
const viewer = await call('POST', '/api/targets/' + t.id + '/assessments', 'it.manager');
expect(viewer.status === 403, `viewer cannot run assessment (${viewer.status})`);
const a = (await call('POST', '/api/targets/' + t.id + '/assessments', 'dba.lead')).data;
expect(a.findings.length > 0, `assessment: ${a.findings.length} findings, health ${a.score.overall} ${a.score.status}`);
const an = (await call('POST', `/api/assessments/${a.id}/analysis`, 'dba.lead')).data;
expect(an.id, `analysis mode=${an.mode} grounded=${an.grounded} model=${an.meta.model ?? '-'} tokens=${an.meta.inputTokens ?? '-'}/${an.meta.outputTokens ?? '-'}`);
const withAction = an.analyses.filter((x: any) => x.proposed_action);
console.log('      proposals:', withAction.map((x: any) => `${x.proposed_action.action_id}(${JSON.stringify(x.proposed_action.params)})`).join(', '));
const analyzeItem = withAction.find((x: any) => x.proposed_action.action_id === 'analyze_table');
expect(analyzeItem, 'agent proposed analyze_table');
const avItem = withAction.find((x: any) => x.proposed_action.action_id === 'set_table_autovacuum');
if (avItem) {
  const blocked = (await call('POST', `/api/analyses/${an.id}/proposals`, 'dba.lead', { findingId: avItem.finding_id })).data;
  expect(blocked.status === 'BLOCKED', `set_table_autovacuum is ${blocked.status}: ${blocked.policy?.reasons?.join(' | ')}`);
}
const ch = (await call('POST', `/api/analyses/${an.id}/proposals`, 'dba.lead', { findingId: analyzeItem.finding_id })).data;
expect(ch.status === 'PENDING_APPROVAL', `change #${ch.number} ${ch.status}; command: ${ch.plan?.command}`);
const early = await call('POST', `/api/changes/${ch.id}/execute`, 'dba.lead');
expect(early.status === 409, `cannot execute before approval (${early.status})`);
const oncall = await call('POST', `/api/changes/${ch.id}/approve`, 'dba.oncall');
expect(oncall.status === 403, `dba.oncall (no approver role) cannot approve (${oncall.status})`);
const ap = (await call('POST', `/api/changes/${ch.id}/approve`, 'dba.lead', { note: 'Approved for demo' })).data;
expect(ap.status === 'APPROVED', `approved by ${ap.decided_by}, fingerprint ${String(ap.fingerprint).slice(0, 12)}…, expires ${ap.expires_at}`);

await call('POST', '/api/kill-switch', 'dba.lead', { engaged: true, reason: 'e2e test', cancelPending: false });
const ks = (await call('POST', `/api/changes/${ch.id}/execute`, 'dba.lead')).data;
expect(ks.refused?.includes('EMERGENCY STOP'), `kill switch blocks execution: ${ks.refused}`);
await call('POST', '/api/kill-switch', 'dba.lead', { engaged: false, reason: 'e2e test done' });

if (tamper) {
  execFileSync(process.execPath, ['scripts/lab.ts', 'tamper'], { stdio: 'inherit' });
  const ex = (await call('POST', `/api/changes/${ch.id}/execute`, 'dba.lead')).data;
  expect(ex.status === 'EXPIRED' && ex.refused === 'Preconditions changed. Approval expired.', `TOCTOU: ${ex.status} - ${ex.refused}`);
} else {
  const ex = (await call('POST', `/api/changes/${ch.id}/execute`, 'dba.lead')).data;
  expect(ex.status === 'COMPLETED', `executed: ${ex.status} outcome=${ex.verification?.outcome}`);
  console.log('      ' + ex.verification?.summary);
  for (const c of ex.verification?.checks ?? []) console.log(`      ${c.ok ? 'ok ' : 'NO '} ${c.description}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
}
const audit = (await call('GET', '/api/audit/verify', 'dba.lead')).data;
expect(audit.valid, `audit chain valid (${audit.events} events)`);
