// Lab cluster manager. LAB ONLY.
// Uses the binaries of the existing PostgreSQL 17 install read-only; never touches its data directory.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync, rmSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, join, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LAB_DIR = join(ROOT, 'lab');
const PGDATA = join(LAB_DIR, 'pgdata');
const LOGFILE = join(LAB_DIR, 'postgres.log');
const ENV_FILE = join(ROOT, '.env');
const PG_BIN = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const PORT = 55432;
const HOST = '127.0.0.1';
const SUPERUSER = 'lab_admin';

// Hard guard: every destructive operation must target ./lab/pgdata inside this project.
function assertLabDataDir(p: string): void {
  const abs = resolve(p);
  if (!abs.startsWith(LAB_DIR + sep) || abs.toLowerCase().includes('program files')) {
    throw new Error(`Refusing to operate on ${abs}: not inside ${LAB_DIR}`);
  }
}

function bin(name: string): string {
  return join(PG_BIN, `${name}.exe`);
}

function ensureSecrets(): void {
  const wanted = ['LAB_SUPERUSER_PASSWORD', 'DBA_AGENT_RO_PASSWORD', 'DBA_AGENT_EXEC_PASSWORD', 'LAB_APP_PASSWORD'];
  const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  const missing = wanted.filter((k) => !new RegExp(`^${k}=`, 'm').test(current));
  if (missing.length) {
    const lines = missing.map((k) => `${k}=${randomBytes(18).toString('base64url')}`).join('\n');
    appendFileSync(ENV_FILE, (current && !current.endsWith('\n') ? '\n' : '') + lines + '\n');
    console.log(`Generated lab secrets in .env: ${missing.join(', ')}`);
  }
  process.loadEnvFile(ENV_FILE);
}

function pgEnv(password: string): NodeJS.ProcessEnv {
  return { ...process.env, PGPASSWORD: password, PGHOST: HOST, PGPORT: String(PORT) };
}

function psqlFile(file: string, db: string): void {
  execFileSync(bin('psql'), ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', SUPERUSER, '-d', db, '-f', file], {
    env: pgEnv(process.env.LAB_SUPERUSER_PASSWORD!),
    stdio: 'inherit',
  });
}

function psqlAs(user: string, password: string, db: string, sql: string): string {
  return execFileSync(bin('psql'), ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', db, '-c', sql], {
    env: pgEnv(password),
    encoding: 'utf8',
  });
}

function isRunning(): boolean {
  if (!existsSync(PGDATA)) return false;
  return spawnSync(bin('pg_ctl'), ['status', '-D', PGDATA]).status === 0;
}

function init(): void {
  assertLabDataDir(PGDATA);
  if (existsSync(PGDATA)) throw new Error('lab/pgdata already exists. Use lab:reset or lab:destroy first.');
  ensureSecrets();
  mkdirSync(LAB_DIR, { recursive: true });
  const pwfile = join(LAB_DIR, '.pwfile.tmp');
  writeFileSync(pwfile, process.env.LAB_SUPERUSER_PASSWORD!);
  try {
    execFileSync(bin('initdb'), ['-D', PGDATA, '-U', SUPERUSER, '-A', 'scram-sha-256', `--pwfile=${pwfile}`, '-E', 'UTF8', '--no-locale'], {
      stdio: 'inherit',
    });
  } finally {
    rmSync(pwfile, { force: true });
  }
  appendFileSync(
    join(PGDATA, 'postgresql.conf'),
    [
      '',
      '# ---- AI DBA Platform lab settings ----',
      `listen_addresses = '${HOST}'`,
      `port = ${PORT}`,
      'max_connections = 40',
      "shared_preload_libraries = 'pg_stat_statements'",
      "pg_stat_statements.track = 'top'",
      'track_io_timing = on',
      "log_line_prefix = '%m [%p] %u@%d '",
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(PGDATA, 'pg_hba.conf'),
    ['# AI DBA Platform lab: loopback only, SCRAM only.', `host all all 127.0.0.1/32 scram-sha-256`, `host all all ::1/128 scram-sha-256`, ''].join('\n'),
  );
  start();
  seed();
  workload();
}

function start(): void {
  if (isRunning()) return console.log('Lab cluster already running.');
  // stdio must not be inherited: the postmaster would keep the caller's pipes open forever.
  execFileSync(bin('pg_ctl'), ['start', '-D', PGDATA, '-l', LOGFILE, '-w', '-t', '60'], { stdio: 'ignore' });
  console.log(`Lab cluster started on ${HOST}:${PORT} (log: lab/postgres.log)`);
}

function stop(): void {
  if (!isRunning()) return console.log('Lab cluster not running.');
  execFileSync(bin('pg_ctl'), ['stop', '-D', PGDATA, '-m', 'fast', '-w'], { stdio: 'inherit' });
}

function seed(): void {
  ensureSecrets();
  const t0 = Date.now();
  psqlFile(join(LAB_DIR, 'sql', '01_roles_db.sql'), 'postgres');
  psqlFile(join(LAB_DIR, 'sql', '02_schema_data.sql'), 'shopdb');
  console.log(`Seed completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// Application workload so pg_stat_statements reflects reality (runs as app_user, not as the agent).
function workload(): void {
  ensureSecrets();
  const probes = JSON.parse(readFileSync(join(ROOT, 'config', 'probes.json'), 'utf8')).probes;
  const report = probes.find((p: { id: string }) => p.id === 'pending_orders_by_region').sql;
  const sql = [
    "SET statement_timeout = '30s';",
    ...Array.from({ length: 3 }, () => `${report};`),
    ...Array.from({ length: 50 }, (_, i) => `SELECT id, status, total FROM public.orders WHERE id = ${1 + ((i * 104729) % 550000)};`),
    ...Array.from({ length: 20 }, (_, i) => `SELECT count(*) FROM public.orders WHERE customer_id = ${1 + ((i * 7919) % 50000)};`),
  ].join('\n');
  const t0 = Date.now();
  psqlAs('app_user', process.env.LAB_APP_PASSWORD!, 'shopdb', sql);
  console.log(`Workload completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// Simulates another DBA analyzing the table out-of-band (used to demonstrate TOCTOU protection).
function tamper(): void {
  ensureSecrets();
  psqlAs(SUPERUSER, process.env.LAB_SUPERUSER_PASSWORD!, 'shopdb', 'ANALYZE public.orders;');
  console.log('Out-of-band change applied: ANALYZE public.orders (as lab_admin).');
}

function destroy(): void {
  assertLabDataDir(PGDATA);
  if (isRunning()) stop();
  rmSync(PGDATA, { recursive: true, force: true });
  rmSync(LOGFILE, { force: true });
  console.log('Lab cluster destroyed. The existing PostgreSQL installation was not touched.');
}

const commands: Record<string, () => void> = {
  init,
  start,
  stop,
  seed,
  workload,
  tamper,
  destroy,
  reset: () => {
    start();
    seed();
    workload();
  },
  // Full demo reset: degraded lab + empty platform store and outbox. Stop the server first (SQLite file lock).
  'demo-reset': () => {
    for (const d of ['data', 'outbox']) {
      const p = join(ROOT, d);
      if (!p.startsWith(ROOT + sep)) throw new Error('refusing path outside project');
      rmSync(p, { recursive: true, force: true });
    }
    console.log('Platform store (data/) and outbox/ cleared.');
    start();
    seed();
    workload();
  },
  status: () => console.log(isRunning() ? `Lab cluster running on ${HOST}:${PORT}` : 'Lab cluster not running.'),
};

const cmd = process.argv[2];
if (!cmd || !commands[cmd]) {
  console.error(`Usage: node scripts/lab.ts <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
commands[cmd]();
