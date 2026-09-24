// Captures REAL concurrent-load telemetry on the lab, before and after the ANALYZE fix, for the intro video.
// Open-loop load (fixed arrival rate, like real users) running the registered probe as app_user.
// Sampler (dba_agent_ro, pg_monitor) reads pg_stat_activity every SAMPLE_MS; host CPU from node:os.
// Output: public/intro-data/load-capture.json. LAB ONLY: reseeds shopdb first.
//
// Usage: node scripts/capture-load.ts [ratePerSec=5] [seconds=30]
import pg from 'pg';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
process.loadEnvFile(join(ROOT, '.env'));
const RATE = Number(process.argv[2] ?? 5);
const SECONDS = Number(process.argv[3] ?? 30);
const SAMPLE_MS = 500;
const POOL_MAX = 10; // app_user has CONNECTION LIMIT 10 in the lab seed: a typical application pool
const probe = JSON.parse(readFileSync(join(ROOT, 'config', 'probes.json'), 'utf8')).probes[0];
const conn = { host: '127.0.0.1', port: 55432, database: 'shopdb' };

type Sample = { t: number; cpuPct: number; sessions: Record<string, number>; userSessions: number; parallelWorkers: number; queued: number };
type Completion = { t: number; ms: number; ok: boolean };

function cpuTimes() {
  return os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq }), { idle: 0, total: 0 });
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
};

async function phase(label: string) {
  const app = new pg.Pool({ ...conn, user: 'app_user', password: process.env.LAB_APP_PASSWORD, max: POOL_MAX, application_name: `load-${label}` });
  const mon = new pg.Client({ ...conn, user: 'dba_agent_ro', password: process.env.DBA_AGENT_RO_PASSWORD, application_name: 'ai-dba-platform/sampler' });
  app.on('error', () => {});
  await mon.connect();
  const t0 = performance.now();
  const samples: Sample[] = [];
  const completions: Completion[] = [];
  const inflight = new Set<Promise<void>>();
  let prev = cpuTimes();

  const sampler = setInterval(async () => {
    const now = cpuTimes();
    const cpuPct = Math.round((1 - (now.idle - prev.idle) / Math.max(now.total - prev.total, 1)) * 1000) / 10;
    prev = now;
    try {
      // Active sessions of the application (leaders + their parallel workers), classified by wait class.
      const r = await mon.query(`
        SELECT CASE WHEN wait_event_type IS NULL THEN 'CPU' WHEN wait_event_type IN ('IO','Lock','LWLock') THEN wait_event_type ELSE 'Other' END AS cls,
               (backend_type = 'parallel worker') AS worker, count(*)::int AS n
        FROM pg_stat_activity
        WHERE state = 'active' AND (application_name = $1 OR (backend_type = 'parallel worker' AND leader_pid IN (SELECT pid FROM pg_stat_activity WHERE application_name = $1)))
        GROUP BY 1, 2`, [`load-${label}`]);
      const sessions: Record<string, number> = { CPU: 0, IO: 0, Lock: 0, LWLock: 0, Other: 0 };
      let userSessions = 0, parallelWorkers = 0;
      for (const row of r.rows) {
        sessions[row.cls] += row.n;
        if (row.worker) parallelWorkers += row.n;
        else userSessions += row.n;
      }
      samples.push({ t: Math.round(performance.now() - t0), cpuPct, sessions, userSessions, parallelWorkers, queued: app.waitingCount });
    } catch {
      /* sampler must never disturb the run */
    }
  }, SAMPLE_MS);

  const fire = () => {
    const start = performance.now();
    const p = (async () => {
      let c: pg.PoolClient | undefined;
      try {
        c = await app.connect();
        await c.query("SET statement_timeout = '30s'");
        await c.query(probe.sql);
        completions.push({ t: Math.round(performance.now() - t0), ms: Math.round(performance.now() - start), ok: true });
      } catch {
        completions.push({ t: Math.round(performance.now() - t0), ms: Math.round(performance.now() - start), ok: false });
      } finally {
        c?.release();
      }
    })();
    inflight.add(p);
    p.finally(() => inflight.delete(p));
  };

  const arrivals = setInterval(fire, 1000 / RATE);
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(arrivals);
  const issued = completions.length + inflight.size;
  await Promise.race([Promise.all([...inflight]), new Promise((r) => setTimeout(r, 40_000))]);
  await new Promise((r) => setTimeout(r, SAMPLE_MS * 2));
  clearInterval(sampler);
  await mon.end();
  await app.end();

  const ok = completions.filter((c) => c.ok);
  const inWindow = ok.filter((c) => c.t <= SECONDS * 1000);
  const loadSamples = samples.filter((s) => s.t <= SECONDS * 1000);
  const total = (s: Sample) => Object.values(s.sessions).reduce((a, b) => a + b, 0);
  const summary = {
    issued,
    completed: ok.length,
    failedOrTimedOut: completions.length - ok.length,
    completedWithinWindow: inWindow.length,
    throughputPerMin: Math.round((inWindow.length / SECONDS) * 60),
    latencyP50Ms: pct(ok.map((c) => c.ms), 50),
    latencyP95Ms: pct(ok.map((c) => c.ms), 95),
    avgActiveSessions: Math.round((loadSamples.reduce((a, s) => a + total(s), 0) / Math.max(loadSamples.length, 1)) * 10) / 10,
    maxActiveSessions: Math.max(0, ...loadSamples.map(total)),
    avgUserSessions: Math.round((loadSamples.reduce((a, s) => a + s.userSessions, 0) / Math.max(loadSamples.length, 1)) * 10) / 10,
    avgParallelWorkers: Math.round((loadSamples.reduce((a, s) => a + s.parallelWorkers, 0) / Math.max(loadSamples.length, 1)) * 10) / 10,
    avgCpuPct: Math.round((loadSamples.reduce((a, s) => a + s.cpuPct, 0) / Math.max(loadSamples.length, 1)) * 10) / 10,
    maxQueuedForConnection: Math.max(0, ...loadSamples.map((s) => s.queued)),
    lockWaitSamples: loadSamples.filter((s) => s.sessions.Lock > 0).length,
    drainMs: Math.max(0, ...completions.map((c) => c.t)) - SECONDS * 1000,
  };
  console.log(label.toUpperCase(), JSON.stringify(summary));
  return { samples, completions, summary };
}

console.log(`Reseeding lab (degraded state)…`);
execFileSync(process.execPath, [join(ROOT, 'scripts', 'lab.ts'), 'reset'], { stdio: 'ignore' });
console.log(`Load: ${RATE} reports/s arriving for ${SECONDS}s, pool max ${POOL_MAX}, sampling every ${SAMPLE_MS} ms`);
const before = await phase('before');

const exec = new pg.Client({ ...conn, user: 'dba_agent_exec', password: process.env.DBA_AGENT_EXEC_PASSWORD });
await exec.connect();
const a0 = performance.now();
await exec.query('ANALYZE public.orders');
const analyzeMs = Math.round(performance.now() - a0);
await exec.end();
console.log(`ANALYZE public.orders as dba_agent_exec: ${analyzeMs} ms`);
await new Promise((r) => setTimeout(r, 3000));

const after = await phase('after');
const out = {
  capturedAt: new Date().toISOString(),
  source: 'Real measurement on the isolated PostgreSQL 17 lab (scripts/capture-load.ts). Not simulated.',
  host: { cpuModel: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ramGb: Math.round(os.totalmem() / 2 ** 30) },
  load: { query: probe.name_es ?? probe.name, sloMs: probe.slo_ms, arrivalsPerSec: RATE, seconds: SECONDS, sampleMs: SAMPLE_MS, poolMax: POOL_MAX, identity: 'app_user' },
  fix: { command: 'ANALYZE public.orders', identity: 'dba_agent_exec', durationMs: analyzeMs },
  before,
  after,
};
mkdirSync(join(ROOT, 'public', 'intro-data'), { recursive: true });
writeFileSync(join(ROOT, 'public', 'intro-data', 'load-capture.json'), JSON.stringify(out));
console.log('Saved public/intro-data/load-capture.json');
