// Stage-0 gate: measures the registered probe before/after ANALYZE and checks role separation. LAB ONLY.
import pg from 'pg';
import { readFileSync } from 'node:fs';

process.loadEnvFile('.env');
const probe = JSON.parse(readFileSync('config/probes.json', 'utf8')).probes[0];
const conn = (user: string, password: string) =>
  new pg.Client({ host: '127.0.0.1', port: 55432, database: 'shopdb', user, password });

type PlanNode = { 'Node Type': string; 'Relation Name'?: string; 'Plan Rows': number; 'Actual Rows': number; 'Actual Loops': number; Plans?: PlanNode[] };

function walk(n: PlanNode, depth = 0, out: string[] = []): string[] {
  out.push(`${'  '.repeat(depth)}${n['Node Type']}${n['Relation Name'] ? ' on ' + n['Relation Name'] : ''}  est=${n['Plan Rows']} actual=${n['Actual Rows']} loops=${n['Actual Loops']}`);
  n.Plans?.forEach((c) => walk(c, depth + 1, out));
  return out;
}

async function explainAnalyze(c: pg.Client) {
  await c.query('BEGIN READ ONLY');
  const r = await c.query(`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON, FORMAT JSON) ${probe.sql}`);
  await c.query('COMMIT');
  return r.rows[0]['QUERY PLAN'][0];
}

async function measure(label: string) {
  const c = conn('dba_agent_ro', process.env.DBA_AGENT_RO_PASSWORD!);
  await c.connect();
  const runs: number[] = [];
  let plan;
  for (let i = 0; i < 3; i++) {
    plan = await explainAnalyze(c);
    runs.push(plan['Execution Time']);
  }
  await c.end();
  console.log(`\n=== ${label} === execution ms: ${runs.map((x) => x.toFixed(1)).join(', ')}`);
  console.log(walk(plan.Plan).join('\n'));
}

async function expectFailure(label: string, user: string, pw: string, sql: string) {
  const c = conn(user, pw);
  await c.connect();
  try {
    await c.query(sql);
    console.log(`!! ${label}: UNEXPECTEDLY SUCCEEDED`);
  } catch (e) {
    console.log(`ok ${label}: ${(e as Error).message}`);
  } finally {
    await c.end();
  }
}

await measure('BEFORE (stale statistics)');
await expectFailure('RO cannot write', 'dba_agent_ro', process.env.DBA_AGENT_RO_PASSWORD!, 'UPDATE public.orders SET total = total WHERE id = 1');
await expectFailure('EXEC cannot read data', 'dba_agent_exec', process.env.DBA_AGENT_EXEC_PASSWORD!, 'SELECT count(*) FROM public.orders');
await expectFailure('EXEC cannot ALTER', 'dba_agent_exec', process.env.DBA_AGENT_EXEC_PASSWORD!, 'ALTER TABLE public.orders RESET (autovacuum_enabled)');
if (process.argv.includes('--analyze')) {
  const c = conn('dba_agent_exec', process.env.DBA_AGENT_EXEC_PASSWORD!);
  await c.connect();
  await c.query('ANALYZE public.orders');
  await c.end();
  console.log('\nok EXEC ran ANALYZE public.orders via MAINTAIN');
  await measure('AFTER ANALYZE');
}
