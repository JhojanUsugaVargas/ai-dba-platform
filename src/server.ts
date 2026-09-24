// HTTP API + static UI. node:http only; no framework. Identity comes from the X-Actor header (simulated login).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { HttpError, Platform } from './platform.ts';
import { j, pj } from './core/store.ts';
import { log, newId, nowIso } from './core/util.ts';
import { getAssessment, latestAssessment, runAssessment } from './assessment/engine.ts';
import { analyzeAssessment } from './agent/analyst.ts';
import { approveChange, decideChange, executeChange, getChange, listChanges, proposeChange, refreshEvidence, setKillSwitch } from './actions/changes.ts';
import { CATALOG } from './actions/catalog.ts';
import { AUTONOMY_NAMES } from './core/types.ts';
import { parseAssumptions, renderPdf, reportData } from './report/report.ts';

const ROOT = resolve(import.meta.dirname, '..');
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));
const PORT = Number(process.env.PORT ?? 8787);
const p = new Platform(ROOT);

type Handler = (ctx: { req: IncomingMessage; params: Record<string, string>; body: any; actorId?: string }) => Promise<unknown> | unknown;
const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, pattern, keys, handler });
}

// ---------- Targets ----------
route('GET', '/api/identities', () => p.identities);
route('GET', '/api/catalog', () => CATALOG.map(({ requiredCapability, ...a }) => a));

route('GET', '/api/state', () => {
  const targets = p.store.all('SELECT id FROM targets ORDER BY created_at').map((t) => p.target(String(t.id)));
  const target = targets[0] ?? null;
  const assessment: any = target ? latestAssessment(p.store, target.id) : undefined;
  const analysis = assessment ? p.store.get('SELECT * FROM analyses WHERE assessment_id = ? ORDER BY created_at DESC LIMIT 1', assessment.id) : undefined;
  return {
    now: nowIso(),
    llm: { available: p.llm.available(), provider: p.llm.name },
    killSwitch: p.killSwitch(),
    target: target && { ...target, autonomy_name: AUTONOMY_NAMES[target.autonomy_level] },
    assessment: assessment && { id: assessment.id, started_at: assessment.started_at, finished_at: assessment.finished_at, score: assessment.score, findings: assessment.findings, collector_runs: assessment.collector_runs },
    analysis: analysis && { ...analysis, output: pj(analysis.output) },
    changes: target ? listChanges(p, target.id) : [],
    notifications: p.store.all('SELECT * FROM notifications ORDER BY ts DESC LIMIT 20').map((n) => ({ ...n, body: pj(n.body) })),
    auditCount: Number(p.store.get('SELECT count(*) AS n FROM audit_events')!.n),
  };
});

route('POST', '/api/targets', async ({ body, actorId }) => {
  const who = p.actor(actorId, 'dba');
  const engine = body.engine ?? 'postgresql';
  if (engine !== 'postgresql' && engine !== 'oracle') throw new HttpError(400, `Engine ${engine} is not available yet (SQL Server and MySQL adapters are planned).`);
  // Lab defaults per engine; Oracle endpoint comes from .env (ORA_LAB_HOST / ORA_LAB_PORT / ORA_LAB_SERVICE).
  const d = engine === 'oracle'
    ? { name: 'Oracle Lab', host: process.env.ORA_LAB_HOST ?? '127.0.0.1', port: Number(process.env.ORA_LAB_PORT ?? 1521), database: process.env.ORA_LAB_SERVICE ?? 'FREEPDB1', ro_user: 'AIDBA_RO', ro_ref: 'env:ORA_AGENT_RO_PASSWORD', exec_user: 'AIDBA_EXEC', exec_ref: 'env:ORA_AGENT_EXEC_PASSWORD' }
    : { name: 'PostgreSQL Lab', host: '127.0.0.1', port: 55432, database: 'shopdb', ro_user: 'dba_agent_ro', ro_ref: 'env:DBA_AGENT_RO_PASSWORD', exec_user: 'dba_agent_exec', exec_ref: 'env:DBA_AGENT_EXEC_PASSWORD' };
  const t = {
    id: newId('tgt'), name: body.name ?? d.name, engine, host: body.host ?? d.host, port: Number(body.port ?? d.port), database: body.database ?? d.database,
    ro_user: body.ro_user ?? d.ro_user, ro_secret_ref: body.ro_secret_ref ?? d.ro_ref,
    exec_user: body.exec_user ?? d.exec_user, exec_secret_ref: body.exec_secret_ref ?? d.exec_ref, autonomy_level: 2,
  };
  if (!/^env:[A-Z0-9_]+$/.test(t.ro_secret_ref) || !/^env:[A-Z0-9_]+$/.test(t.exec_secret_ref)) throw new HttpError(400, 'Secrets must be references (env:NAME), never values.');
  p.store.run(
    'INSERT INTO targets(id,name,engine,host,port,database,ro_user,ro_secret_ref,exec_user,exec_secret_ref,autonomy_level,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    t.id, t.name, t.engine, t.host, t.port, t.database, t.ro_user, t.ro_secret_ref, t.exec_user, t.exec_secret_ref, t.autonomy_level, who.id, nowIso(),
  );
  p.audit.write({ actor: who.id, type: 'TARGET_REGISTERED', target: t.id, payload: { ...t, note: 'Secrets stored as references only.' } });
  return p.target(t.id);
});

route('POST', '/api/targets/:id/validate', async ({ params, actorId }) => {
  const who = p.actor(actorId, 'dba');
  const target = p.target(params.id);
  const adapter = p.adapter(target);
  const ident = await adapter.connectAndIdentify();
  if (!ident.supported) throw new HttpError(422, `Server version ${ident.version} is outside the adapter's supported range (${adapter.supportedVersions}).`);
  const perms = await adapter.validatePermissions();
  p.store.run('UPDATE targets SET server_version = ?, permission_report = ?, validated_at = ? WHERE id = ?', ident.version, j(perms), nowIso(), target.id);
  p.audit.write({ actor: who.id, type: 'PERMISSIONS_VALIDATED', target: target.id, payload: { version: ident.version, adapter: `${adapter.engine} ${adapter.supportedVersions}`, ro: { verdict: perms.ro.verdict, failed: perms.ro.checks.filter((c) => !c.ok).map((c) => c.id) }, exec: { verdict: perms.exec.verdict, capabilities: perms.exec.capabilities } } });
  return { version: ident.version, adapter: `${adapter.engine} ${adapter.supportedVersions}`, ...perms };
});

route('POST', '/api/targets/:id/autonomy', ({ params, body, actorId }) => {
  const who = p.actor(actorId, 'approver');
  const level = Number(body.level);
  if (![0, 1, 2, 3, 4].includes(level)) throw new HttpError(400, 'level must be 0..4');
  const before = p.target(params.id).autonomy_level;
  p.store.run('UPDATE targets SET autonomy_level = ? WHERE id = ?', level, params.id);
  p.audit.write({ actor: who.id, type: 'AUTONOMY_CHANGED', target: params.id, payload: { from: before, to: level, name: AUTONOMY_NAMES[level] } });
  return p.target(params.id);
});

// ---------- Assessment & analysis ----------
route('POST', '/api/targets/:id/assessments', async ({ params, actorId }) => {
  const who = p.actor(actorId, 'dba');
  const target = p.target(params.id);
  if (target.permission_report?.ro?.verdict !== 'OK') throw new HttpError(409, 'Read-only identity not validated. Run permission validation first; the platform refuses to assess with an unverified identity.');
  const a: any = await runAssessment(p.store, p.audit, p.adapter(target), target, who.id);
  const serious = a.findings.filter((f: any) => f.severity === 'HIGH' || f.severity === 'CRITICAL');
  if (serious.length) {
    await p.notify.alert({
      severity: serious.some((f: any) => f.severity === 'CRITICAL') ? 'CRITICAL' : 'HIGH', subject: `${serious.length} high-severity finding(s) on ${target.name}`,
      target: target.name, engine: `${target.engine} ${target.server_version}`, event: 'DBA assessment', evidence: serious.map((f: any) => ({ severity: f.severity, title: f.title, facts: f.facts })),
      probableCause: serious[0].detail, recommendation: 'Review findings and pending change plans in the AI DBA console.', status: 'OPEN',
    });
  }
  return a;
});

route('GET', '/api/assessments/:id', ({ params }) => getAssessment(p.store, params.id) ?? Promise.reject(new HttpError(404, 'not found')));

route('POST', '/api/assessments/:id/analysis', async ({ params, body, actorId }) => {
  const who = p.actor(actorId, 'dba');
  const a: any = getAssessment(p.store, params.id);
  if (!a) throw new HttpError(404, 'assessment not found');
  return analyzeAssessment(p.store, p.audit, p.llm, a, p.target(String(a.target_id)), who.id, typeof body?.language === 'string' ? body.language : undefined);
});

// ---------- Change management ----------
route('POST', '/api/analyses/:id/proposals', async ({ params, body, actorId }) => {
  p.actor(actorId, 'dba');
  const an = p.store.get('SELECT * FROM analyses WHERE id = ?', params.id);
  if (!an) throw new HttpError(404, 'analysis not found');
  const item = (pj<any>(an.output).analyses as any[]).find((x) => x.finding_id === body.findingId);
  if (!item?.proposed_action) throw new HttpError(400, 'No validated action proposal for that finding');
  const a: any = getAssessment(p.store, String(an.assessment_id));
  return proposeChange(p, { targetId: String(a.target_id), assessmentId: a.id, findingId: item.finding_id, analysisId: String(an.id), actionId: item.proposed_action.action_id, params: item.proposed_action.params, rationale: item.proposed_action.justification });
});

route('GET', '/api/changes', () => listChanges(p));
route('GET', '/api/changes/:id', ({ params }) => getChange(p, params.id));
route('POST', '/api/changes/:id/approve', ({ params, body, actorId }) => approveChange(p, params.id, p.actor(actorId, 'approver'), body.note));
route('POST', '/api/changes/:id/reject', ({ params, body, actorId }) => decideChange(p, params.id, p.actor(actorId, 'approver'), 'REJECTED', body.note));
route('POST', '/api/changes/:id/cancel', ({ params, body, actorId }) => decideChange(p, params.id, p.actor(actorId, 'dba'), 'CANCELLED', body.note));
route('POST', '/api/changes/:id/evidence', ({ params, body, actorId }) => refreshEvidence(p, params.id, p.actor(actorId, 'dba'), body.note));
route('POST', '/api/changes/:id/execute', ({ params, actorId }) => executeChange(p, params.id, p.actor(actorId, 'dba')));

route('POST', '/api/kill-switch', ({ body, actorId }) => setKillSwitch(p, p.actor(actorId, 'dba'), Boolean(body.engaged), String(body.reason ?? ''), body.cancelPending !== false));

// ---------- Business report (PDF) ----------
class BinaryBody {
  data: Buffer;
  type: string;
  filename: string;
  constructor(data: Buffer, type: string, filename: string) {
    this.data = data;
    this.type = type;
    this.filename = filename;
  }
}
route('GET', '/api/changes/:id/report-data', ({ params }) => reportData(p, params.id));
route('POST', '/api/changes/:id/report', async ({ params, body, actorId }) => {
  const who = p.actor(actorId, 'viewer');
  const data = reportData(p, params.id); // 409 if there is no measured verification yet
  const assumptions = parseAssumptions(body ?? {}, who.id);
  const q = new URLSearchParams({ change: params.id, by: who.id });
  if (assumptions.runsPerDay != null) q.set('runsPerDay', String(assumptions.runsPerDay));
  if (assumptions.costPerUserHourUsd != null) q.set('costPerUserHourUsd', String(assumptions.costPerUserHourUsd));
  const pdf = await renderPdf(`http://127.0.0.1:${PORT}/report.html?${q}`);
  p.audit.write({ actor: who.id, type: 'REPORT_GENERATED', target: getChange(p, params.id).target_id, changeId: params.id, payload: { number: data.change.number, format: 'pdf', bytes: pdf.length, assumptions } });
  return new BinaryBody(pdf, 'application/pdf', `AI-DBA-cambio-${data.change.number}.pdf`);
});

// ---------- Audit ----------
route('GET', '/api/audit', ({ req }) => {
  const u = new URL(req.url!, 'http://x');
  return p.audit.list(Number(u.searchParams.get('limit') ?? 200), u.searchParams.get('change') ?? undefined);
});
route('GET', '/api/audit/verify', () => p.audit.verify());
route('GET', '/api/notifications', () => p.store.all('SELECT * FROM notifications ORDER BY ts DESC LIMIT 50').map((n) => ({ ...n, body: pj(n.body) })));

// ---------- Plumbing ----------
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const PUBLIC = join(ROOT, 'public');

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 100_000) throw new HttpError(413, 'Body too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const t0 = Date.now();
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers['content-type'] && !String(req.headers['content-type']).includes('application/json')) throw new HttpError(415, 'JSON only');
      for (const r of routes) {
        const m = req.method === r.method && url.pathname.match(r.pattern);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const body = req.method === 'GET' ? {} : await readBody(req);
        const out = await r.handler({ req, params, body, actorId: req.headers['x-actor'] as string | undefined });
        if (out instanceof BinaryBody) {
          res.writeHead(200, { 'content-type': out.type, 'content-disposition': `attachment; filename="${out.filename}"`, 'cache-control': 'no-store' });
          res.end(out.data);
        } else send(res, 200, out ?? { ok: true });
        if (req.method !== 'GET') log('info', 'api', { method: req.method, path: url.pathname, actor: req.headers['x-actor'], ms: Date.now() - t0 });
        return;
      }
      throw new HttpError(404, `No route ${req.method} ${url.pathname}`);
    }
    const file = normalize(join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC)) throw new HttpError(403, 'Forbidden');
    const data = await readFile(file).catch(() => null);
    if (!data) throw new HttpError(404, 'Not found');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) log('error', 'request failed', { path: url.pathname, error: (e as Error).message });
    else if (url.pathname.startsWith('/api/')) log('warn', 'request rejected', { status, method: req.method, path: url.pathname, actor: req.headers['x-actor'], error: (e as Error).message });
    send(res, status, { error: (e as Error).message });
  }
});

server.listen(PORT, '127.0.0.1', () => log('info', `AI DBA Platform listening on http://127.0.0.1:${PORT}`, { llm: p.llm.available() ? 'configured' : 'not configured (rule-based fallback)' }));
const shutdown = async () => {
  server.close();
  await p.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
