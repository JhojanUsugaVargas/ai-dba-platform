// Smoke test: permission validation + full assessment against the lab, with an in-memory store.
import { resolve } from 'node:path';
import { Store } from '../src/core/store.ts';
import { Audit } from '../src/core/audit.ts';
import { createAdapter } from '../src/adapters/postgres/adapter.ts';
import { runAssessment } from '../src/assessment/engine.ts';
import type { Target } from '../src/core/types.ts';

process.loadEnvFile('.env');
const root = resolve(import.meta.dirname, '..');
const target: Target = {
  id: 'tgt_lab', name: 'PostgreSQL Lab', engine: 'postgresql', host: '127.0.0.1', port: 55432, database: 'shopdb',
  ro_user: 'dba_agent_ro', ro_secret_ref: 'env:DBA_AGENT_RO_PASSWORD', exec_user: 'dba_agent_exec', exec_secret_ref: 'env:DBA_AGENT_EXEC_PASSWORD', autonomy_level: 2,
};
const store = new Store(':memory:');
const audit = new Audit(store);
store.run("INSERT INTO targets(id,name,engine,host,port,database,ro_user,ro_secret_ref,exec_user,exec_secret_ref,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'smoke',datetime())",
  target.id, target.name, target.engine, target.host, target.port, target.database, target.ro_user, target.ro_secret_ref, target.exec_user, target.exec_secret_ref);
const adapter = createAdapter(target, root);
console.log('identify:', await adapter.connectAndIdentify());
const perms = await adapter.validatePermissions();
for (const r of [perms.ro, perms.exec]) {
  console.log(`\n[${r.identity}] ${r.user} verdict=${r.verdict} caps=${r.capabilities.join(' | ')}`);
  for (const c of r.checks) console.log(`  ${c.ok ? 'ok ' : 'NO '} ${c.description} -> ${JSON.stringify(c.observed)}`);
}
const t0 = Date.now();
const a: any = await runAssessment(store, audit, adapter, target, 'dba.lead');
console.log(`\nassessment ${Date.now() - t0}ms`);
for (const r of a.collector_runs) console.log(`  ${r.status.padEnd(7)} ${String(r.ms).padStart(5)}ms ${r.collector}${r.error ? ' ERR ' + r.error : ''}`);
console.log(`\nHEALTH ${a.score.overall} ${a.score.status} coverage ${a.score.coverage.scored}/${a.score.coverage.total}`);
for (const d of a.score.dimensions) console.log(`  ${d.dimension.padEnd(14)} ${d.status.padEnd(15)} ${d.score ?? '-'}  ${d.penalties.map((p: any) => p.severity + ':' + p.ruleId).join(', ')}`);
console.log('\nFINDINGS');
for (const f of a.findings) console.log(`  [${f.severity}] ${f.title}\n      ${f.detail}\n      actions=${JSON.stringify(f.candidate_actions)}`);
console.log('\naudit chain:', audit.verify());
await adapter.close();
