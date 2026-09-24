// Downloads the business PDF for the latest completed change, with and without business assumptions.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const outDir = process.argv[2] ?? '.';
const changes: any[] = await (await fetch(`${BASE}/api/changes`)).json();
const c = changes.find((x) => x.status === 'COMPLETED');
if (!c) throw new Error('No COMPLETED change; run the e2e flow first');

const pending = changes.find((x) => x.status !== 'COMPLETED');
if (pending) {
  const r = await fetch(`${BASE}/api/changes/${pending.id}/report`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': 'dba.lead' }, body: '{}' });
  console.log(`${r.status === 409 ? 'PASS' : 'FAIL'}  change without verification refused (${r.status}: ${(await r.json()).error})`);
}
for (const [name, body] of [['sin-supuestos', {}], ['con-supuestos', { runsPerDay: 5000, costPerUserHourUsd: 12 }]] as const) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/changes/${c.id}/report`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': 'it.manager' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.json()).error}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const file = join(outDir, `report-${name}.pdf`);
  writeFileSync(file, buf);
  console.log(`${buf.subarray(0, 5).toString() === '%PDF-' ? 'PASS' : 'FAIL'}  ${name}: ${buf.length} bytes in ${Date.now() - t0} ms -> ${file}`);
}
const bad = await fetch(`${BASE}/api/changes/${c.id}/report`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': 'dba.lead' }, body: JSON.stringify({ runsPerDay: -5 }) });
console.log(`${bad.status === 400 ? 'PASS' : 'FAIL'}  invalid assumption rejected (${bad.status})`);
