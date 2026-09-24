// Runs connect -> validate -> assess -> AI analysis against a running server and prints the full analysis.
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const call = async (method: string, path: string) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-actor': 'dba.lead' }, body: method === 'POST' ? '{}' : undefined });
  const d: any = await r.json();
  if (!r.ok) throw new Error(`${path}: ${d.error}`);
  return d;
};
const state = await call('GET', '/api/state');
const t = state.target ?? (await call('POST', '/api/targets'));
if (!t.permission_report) await call('POST', `/api/targets/${t.id}/validate`);
const a = state.assessment ?? (await call('POST', `/api/targets/${t.id}/assessments`));
const an = await call('POST', `/api/assessments/${a.id}/analysis`);
const titles = new Map(a.findings.map((f: any) => [f.id, `[${f.severity}] ${f.title}`]));
console.log(`mode=${an.mode} grounded=${an.grounded} model=${an.meta.model} tokens=${an.meta.inputTokens}/${an.meta.outputTokens} latency=${an.meta.latencyMs}ms cost=$${an.meta.costUsd?.toFixed(4)}`);
if (an.fallback_reason) console.log('FALLBACK:', an.fallback_reason);
console.log('\nEXECUTIVE SUMMARY:', an.executive_summary);
console.log('ROOT CAUSE:', an.root_cause_hypothesis);
for (const x of an.analyses) {
  console.log(`\n## ${titles.get(x.finding_id)}  (confidence ${x.confidence})`);
  console.log('what:', x.what);
  console.log('why:', x.why);
  console.log('impact:', x.impact);
  console.log('recommendation:', x.recommendation);
  console.log('related:', x.related_findings.map((r: string) => titles.get(r)).join(' | ') || '-');
  console.log('action:', x.proposed_action ? `${x.proposed_action.action_id}(${JSON.stringify(x.proposed_action.params)}) — ${x.proposed_action.justification}` : 'none');
  console.log('validation:', JSON.stringify(x.validation));
}
