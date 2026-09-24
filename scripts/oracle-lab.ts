// Oracle lab manager. LAB ONLY — run against a non-production Oracle 19c+ PDB (e.g. Oracle Database Free 23ai).
// Creates four clearly-named lab accounts (AIDBA_SHOP / AIDBA_APP / AIDBA_RO / AIDBA_EXEC) and the scenario:
//   "out-of-range predicate after the nightly load": ORDERS statistics were gathered when the newest ORDER_DATE was
//   3 days ago; 150k orders from the last 20 hours are loaded afterwards; the report filters ORDER_DATE >= TRUNC(SYSDATE)-1,
//   which lies beyond the column HIGH_VALUE, so the optimizer estimates ~1 row.
//
// Safety: refuses to run without ORA_LAB_I_CONFIRM_NON_PRODUCTION=yes, never drops an account it did not create
// (AIDBA_SHOP must contain the AIDBA_LAB_MARKER table), and uses only the admin account given in .env.
import oracledb from 'oracledb';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENV_FILE = join(ROOT, '.env');

function ensureSecrets(): void {
  const wanted = ['ORA_AGENT_RO_PASSWORD', 'ORA_AGENT_EXEC_PASSWORD', 'ORA_LAB_APP_PASSWORD'];
  const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  const missing = wanted.filter((k) => !new RegExp(`^${k}=`, 'm').test(current));
  if (missing.length) {
    // Starts with a letter and mixes classes so common PDB password verify functions accept it.
    const lines = missing.map((k) => `${k}=Ai9${randomBytes(15).toString('base64url').replace(/-/g, 'x')}`).join('\n');
    appendFileSync(ENV_FILE, (current && !current.endsWith('\n') ? '\n' : '') + lines + '\n');
    console.log(`Generated Oracle lab secrets in .env: ${missing.join(', ')}`);
  }
  process.loadEnvFile(ENV_FILE);
}

function connectString(): string {
  const host = process.env.ORA_LAB_HOST ?? '127.0.0.1';
  const port = process.env.ORA_LAB_PORT ?? '1521';
  const service = process.env.ORA_LAB_SERVICE ?? 'FREEPDB1';
  return `${host}:${port}/${service}`;
}

async function admin(): Promise<oracledb.Connection> {
  const user = process.env.ORA_LAB_ADMIN_USER ?? 'SYSTEM';
  const password = process.env.ORA_LAB_ADMIN_PASSWORD;
  if (!password) throw new Error('Set ORA_LAB_ADMIN_PASSWORD (and optionally ORA_LAB_ADMIN_USER, default SYSTEM) in .env for lab setup.');
  return oracledb.getConnection({ user, password, connectString: connectString() });
}

async function run(c: oracledb.Connection, sql: string, label = sql.split('\n')[0].slice(0, 90)) {
  const t0 = Date.now();
  await c.execute(sql);
  console.log(`  ok ${String(Date.now() - t0).padStart(6)} ms  ${label}`);
}

async function assertSafeToReset(c: oracledb.Connection): Promise<string[]> {
  const existing = (await c.execute<{ USERNAME: string }>(`SELECT username FROM dba_users WHERE username IN ('AIDBA_APP','AIDBA_RO','AIDBA_EXEC','AIDBA_SHOP')`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows!.map((r) => r.USERNAME);
  if (!existing.length) return [];
  const marker = (await c.execute<{ N: number }>(`SELECT COUNT(*) AS n FROM dba_tables WHERE owner = 'AIDBA_SHOP' AND table_name = 'AIDBA_LAB_MARKER'`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows![0].N;
  if (!marker) throw new Error(`Accounts ${existing.join(', ')} exist but were not created by this lab (no AIDBA_SHOP.AIDBA_LAB_MARKER). Refusing to drop them.`);
  return existing;
}

async function setup(): Promise<void> {
  if (process.env.ORA_LAB_I_CONFIRM_NON_PRODUCTION !== 'yes') throw new Error('Refusing: set ORA_LAB_I_CONFIRM_NON_PRODUCTION=yes in .env to confirm the target is a non-production lab.');
  ensureSecrets();
  const c = await admin();
  try {
    const info = (await c.execute<any>(`SELECT sys_context('USERENV','CON_NAME') AS con, sys_context('USERENV','DB_NAME') AS db, (SELECT version_full FROM v$instance) AS ver FROM dual`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows![0];
    console.log(`Oracle ${info.VER} · container ${info.CON} · db ${info.DB} · ${connectString()}`);
    if (info.CON === 'CDB$ROOT') throw new Error('Connect to a PDB (e.g. FREEPDB1), not CDB$ROOT: lab accounts must be local users.');
    const ts = (await c.execute<any>(`SELECT property_value AS ts FROM database_properties WHERE property_name = 'DEFAULT_PERMANENT_TABLESPACE'`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows![0].TS;

    for (const u of await assertSafeToReset(c)) await run(c, `DROP USER ${u} CASCADE`);
    const q = (s: string) => `"${s.replace(/"/g, '')}"`;
    const T0 = Date.now();
    await run(c, `CREATE USER aidba_shop NO AUTHENTICATION DEFAULT TABLESPACE ${ts} QUOTA UNLIMITED ON ${ts}`, 'CREATE USER aidba_shop NO AUTHENTICATION (schema-only owner)');
    await run(c, `CREATE USER aidba_app IDENTIFIED BY ${q(process.env.ORA_LAB_APP_PASSWORD!)}`, 'CREATE USER aidba_app');
    await run(c, `CREATE USER aidba_ro IDENTIFIED BY ${q(process.env.ORA_AGENT_RO_PASSWORD!)}`, 'CREATE USER aidba_ro');
    await run(c, `CREATE USER aidba_exec IDENTIFIED BY ${q(process.env.ORA_AGENT_EXEC_PASSWORD!)}`, 'CREATE USER aidba_exec');
    await run(c, `GRANT CREATE SESSION TO aidba_app, aidba_ro, aidba_exec`);
    await run(c, `GRANT SELECT_CATALOG_ROLE TO aidba_ro`);

    await run(c, `CREATE TABLE aidba_shop.aidba_lab_marker (created_at DATE DEFAULT SYSDATE NOT NULL)`);
    await run(c, `INSERT INTO aidba_shop.aidba_lab_marker (created_at) VALUES (SYSDATE)`);
    await run(c, `CREATE TABLE aidba_shop.customers (customer_id NUMBER PRIMARY KEY, name VARCHAR2(60) NOT NULL, region VARCHAR2(20) NOT NULL, created_at DATE NOT NULL)`);
    await run(c, `CREATE TABLE aidba_shop.orders (order_id NUMBER PRIMARY KEY, customer_id NUMBER NOT NULL REFERENCES aidba_shop.customers, status VARCHAR2(12) NOT NULL, order_date DATE NOT NULL, total NUMBER(12,2) NOT NULL)`);
    await run(c, `CREATE TABLE aidba_shop.order_items (order_id NUMBER NOT NULL, line_no NUMBER(3) NOT NULL, product_id NUMBER NOT NULL, qty NUMBER NOT NULL, unit_price NUMBER(10,2) NOT NULL, CONSTRAINT order_items_pk PRIMARY KEY (order_id, line_no))`);
    await run(c, `INSERT /*+ APPEND */ INTO aidba_shop.customers
      SELECT level, 'customer_' || level,
             CASE MOD(level, 8) WHEN 0 THEN 'NORTH' WHEN 1 THEN 'SOUTH' WHEN 2 THEN 'EAST' WHEN 3 THEN 'WEST' WHEN 4 THEN 'CENTRAL' WHEN 5 THEN 'ANDINA' WHEN 6 THEN 'CARIBE' ELSE 'PACIFICO' END,
             SYSDATE - MOD(level, 1000)
      FROM dual CONNECT BY level <= 50000`, 'load 50,000 customers');
    await run(c, `COMMIT`);
    // Historical orders: ORDER_DATE spread from SYSDATE-400 to SYSDATE-3, one distinct value every ~85 s.
    await run(c, `INSERT /*+ APPEND */ INTO aidba_shop.orders
      SELECT level, 1 + MOD(level * 7919, 50000), 'DELIVERED', SYSDATE - 400 + level * (397 / 400000), ROUND(10 + MOD(level, 500), 2)
      FROM dual CONNECT BY level <= 400000`, 'load 400,000 historical orders (up to SYSDATE-3)');
    await run(c, `COMMIT`);
    await run(c, `INSERT /*+ APPEND */ INTO aidba_shop.order_items
      SELECT o.n, l.n, 1 + MOD(o.n * 31 + l.n, 5000), 1 + MOD(o.n + l.n, 5), ROUND(5 + MOD(o.n * l.n, 200), 2)
      FROM (SELECT level AS n FROM dual CONNECT BY level <= 400000) o CROSS JOIN (SELECT level AS n FROM dual CONNECT BY level <= 3) l`, 'load 1,200,000 order items');
    await run(c, `COMMIT`);
    await run(c, `CREATE INDEX aidba_shop.orders_date_ix ON aidba_shop.orders (order_date)`);
    await run(c, `CREATE INDEX aidba_shop.orders_cust_ix ON aidba_shop.orders (customer_id)`);
    for (const t of ['CUSTOMERS', 'ORDERS', 'ORDER_ITEMS']) await run(c, `BEGIN DBMS_STATS.GATHER_TABLE_STATS('AIDBA_SHOP', '${t}', cascade => TRUE); END;`, `gather stats ${t} (baseline, before the nightly load)`);

    // Nightly load: 150k orders from the last 20 hours. ORDERS statistics are NOT refreshed.
    await run(c, `INSERT /*+ APPEND */ INTO aidba_shop.orders
      SELECT 400000 + level, 1 + MOD((400000 + level) * 7919, 50000), 'PENDING', SYSDATE - level * (20 / 24) / 150000, ROUND(10 + MOD(level, 500), 2)
      FROM dual CONNECT BY level <= 150000`, 'nightly load: 150,000 orders from the last 20 hours');
    await run(c, `COMMIT`);
    await run(c, `INSERT /*+ APPEND */ INTO aidba_shop.order_items
      SELECT o.n, l.n, 1 + MOD(o.n * 31 + l.n, 5000), 1 + MOD(o.n + l.n, 5), ROUND(5 + MOD(o.n * l.n, 200), 2)
      FROM (SELECT 400000 + level AS n FROM dual CONNECT BY level <= 150000) o CROSS JOIN (SELECT level AS n FROM dual CONNECT BY level <= 3) l`, 'nightly load: 450,000 order items');
    await run(c, `COMMIT`);
    await run(c, `BEGIN DBMS_STATS.GATHER_TABLE_STATS('AIDBA_SHOP', 'ORDER_ITEMS', cascade => TRUE); END;`, 'gather stats ORDER_ITEMS (so only ORDERS is stale)');
    await run(c, `BEGIN DBMS_STATS.FLUSH_DATABASE_MONITORING_INFO; END;`, 'flush DML monitoring (DBA_TAB_MODIFICATIONS / STALE_STATS)');

    // Least-privilege maintenance API: definer-rights package owned by the schema owner, allow-listed tables only.
    await run(c, `CREATE TABLE aidba_shop.dba_maint_allowlist (table_name VARCHAR2(128) PRIMARY KEY)`);
    await run(c, `INSERT INTO aidba_shop.dba_maint_allowlist SELECT column_value FROM TABLE(sys.odcivarchar2list('ORDERS','ORDER_ITEMS','CUSTOMERS'))`);
    await run(c, `CREATE TABLE aidba_shop.dba_maint_log (id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, table_name VARCHAR2(128) NOT NULL, action VARCHAR2(30) NOT NULL,
      requested_by VARCHAR2(128) DEFAULT SYS_CONTEXT('USERENV','SESSION_USER') NOT NULL, logged_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL, restore_as_of TIMESTAMP WITH TIME ZONE)`);
    await run(c, `COMMIT`);
    await run(c, `CREATE OR REPLACE PACKAGE aidba_shop.dba_maint AUTHID DEFINER AS
  PROCEDURE gather_pending (p_table IN VARCHAR2);
  PROCEDURE publish_pending (p_table IN VARCHAR2);
  PROCEDURE delete_pending (p_table IN VARCHAR2);
  PROCEDURE restore_stats (p_table IN VARCHAR2, p_as_of IN TIMESTAMP WITH TIME ZONE);
END dba_maint;`, 'CREATE PACKAGE aidba_shop.dba_maint (spec)');
    await run(c, `CREATE OR REPLACE PACKAGE BODY aidba_shop.dba_maint AS
  c_owner CONSTANT VARCHAR2(128) := $$PLSQL_UNIT_OWNER;

  FUNCTION allowed (p_table IN VARCHAR2) RETURN VARCHAR2 IS
    v_name VARCHAR2(128) := UPPER(DBMS_ASSERT.SIMPLE_SQL_NAME(p_table));
    v_ok   NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_ok FROM dba_maint_allowlist WHERE table_name = v_name;
    IF v_ok = 0 THEN
      RAISE_APPLICATION_ERROR(-20001, 'Table not in DBA_MAINT allow-list: ' || v_name);
    END IF;
    RETURN v_name;
  END allowed;

  PROCEDURE log_action (p_table IN VARCHAR2, p_action IN VARCHAR2, p_restore IN TIMESTAMP WITH TIME ZONE DEFAULT NULL) IS
    PRAGMA AUTONOMOUS_TRANSACTION;
  BEGIN
    INSERT INTO dba_maint_log (table_name, action, restore_as_of) VALUES (p_table, p_action, p_restore);
    COMMIT;
  END log_action;

  -- Gathers into the pending area: invisible to the optimizer until published.
  PROCEDURE gather_pending (p_table IN VARCHAR2) IS
    v_tab VARCHAR2(128) := allowed(p_table);
  BEGIN
    DBMS_STATS.SET_TABLE_PREFS(c_owner, v_tab, 'PUBLISH', 'FALSE');
    DBMS_STATS.GATHER_TABLE_STATS(ownname => c_owner, tabname => v_tab, cascade => TRUE);
    log_action(v_tab, 'GATHER_PENDING');
  END gather_pending;

  -- Publishes and invalidates dependent cursors immediately; records the restore point.
  PROCEDURE publish_pending (p_table IN VARCHAR2) IS
    v_tab    VARCHAR2(128) := allowed(p_table);
    v_before TIMESTAMP WITH TIME ZONE := SYSTIMESTAMP;
  BEGIN
    DBMS_STATS.PUBLISH_PENDING_STATS(ownname => c_owner, tabname => v_tab, no_invalidate => FALSE);
    DBMS_STATS.SET_TABLE_PREFS(c_owner, v_tab, 'PUBLISH', 'TRUE');
    log_action(v_tab, 'PUBLISH_PENDING', v_before);
  END publish_pending;

  PROCEDURE delete_pending (p_table IN VARCHAR2) IS
    v_tab VARCHAR2(128) := allowed(p_table);
  BEGIN
    DBMS_STATS.DELETE_PENDING_STATS(c_owner, v_tab);
    DBMS_STATS.SET_TABLE_PREFS(c_owner, v_tab, 'PUBLISH', 'TRUE');
    log_action(v_tab, 'DELETE_PENDING');
  END delete_pending;

  PROCEDURE restore_stats (p_table IN VARCHAR2, p_as_of IN TIMESTAMP WITH TIME ZONE) IS
    v_tab VARCHAR2(128) := allowed(p_table);
  BEGIN
    DBMS_STATS.RESTORE_TABLE_STATS(ownname => c_owner, tabname => v_tab, as_of_timestamp => p_as_of, no_invalidate => FALSE);
    log_action(v_tab, 'RESTORE_STATS', p_as_of);
  END restore_stats;
END dba_maint;`, 'CREATE PACKAGE BODY aidba_shop.dba_maint (definer rights, allow-list, DBMS_ASSERT)');
    const errs = (await c.execute<any>(`SELECT line, text FROM dba_errors WHERE owner = 'AIDBA_SHOP' AND name = 'DBA_MAINT' ORDER BY sequence`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows!;
    if (errs.length) throw new Error(`Package compilation errors:\n${errs.map((e) => `  line ${e.LINE}: ${e.TEXT}`).join('\n')}`);

    await run(c, `GRANT SELECT ON aidba_shop.customers TO aidba_ro`);
    await run(c, `GRANT SELECT ON aidba_shop.orders TO aidba_ro`);
    await run(c, `GRANT SELECT ON aidba_shop.order_items TO aidba_ro`);
    await run(c, `GRANT SELECT ON aidba_shop.dba_maint_allowlist TO aidba_ro`);
    await run(c, `GRANT SELECT ON aidba_shop.dba_maint_log TO aidba_ro`);
    await run(c, `GRANT EXECUTE ON aidba_shop.dba_maint TO aidba_exec`);
    for (const t of ['customers', 'orders', 'order_items']) await run(c, `GRANT SELECT, INSERT, UPDATE ON aidba_shop.${t} TO aidba_app`);
    console.log(`Oracle lab ready in ${((Date.now() - T0) / 1000).toFixed(1)} s.`);
  } finally {
    await c.close();
  }
  await workload();
}

async function workload(): Promise<void> {
  ensureSecrets();
  const probe = JSON.parse(readFileSync(join(ROOT, 'config', 'probes.oracle.json'), 'utf8')).probes[0];
  const c = await oracledb.getConnection({ user: 'AIDBA_APP', password: process.env.ORA_LAB_APP_PASSWORD, connectString: connectString() });
  try {
    c.callTimeout = 60_000;
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) await c.execute(probe.sql.replace('/*+ GATHER_PLAN_STATISTICS */ ', ''));
    for (let i = 0; i < 50; i++) await c.execute(`SELECT order_id, status, total FROM aidba_shop.orders WHERE order_id = :id`, [1 + ((i * 104729) % 550000)]);
    console.log(`Oracle workload completed in ${((Date.now() - t0) / 1000).toFixed(1)} s (as AIDBA_APP).`);
  } finally {
    await c.close();
  }
}

// Another DBA gathers ORDERS statistics out-of-band (demonstrates TOCTOU protection).
async function tamper(): Promise<void> {
  ensureSecrets();
  const c = await admin();
  try {
    await run(c, `BEGIN DBMS_STATS.GATHER_TABLE_STATS('AIDBA_SHOP', 'ORDERS', cascade => TRUE, no_invalidate => FALSE); END;`, 'out-of-band: GATHER_TABLE_STATS AIDBA_SHOP.ORDERS (as admin)');
  } finally {
    await c.close();
  }
}

async function status(): Promise<void> {
  ensureSecrets();
  const c = await oracledb.getConnection({ user: 'AIDBA_RO', password: process.env.ORA_AGENT_RO_PASSWORD, connectString: connectString() });
  try {
    const r = await c.execute<any>(`SELECT table_name, num_rows, stale_stats, TO_CHAR(last_analyzed, 'YYYY-MM-DD HH24:MI:SS') AS last_analyzed,
        (SELECT COUNT(*) FROM dba_tab_pending_stats p WHERE p.owner = s.owner AND p.table_name = s.table_name) AS pending
      FROM dba_tab_statistics s WHERE owner = 'AIDBA_SHOP' AND object_type = 'TABLE' ORDER BY table_name`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    console.table(r.rows);
  } finally {
    await c.close();
  }
}

const commands: Record<string, () => Promise<void>> = { setup, reset: setup, workload, tamper, status };
const cmd = process.argv[2];
if (!cmd || !commands[cmd]) {
  console.error(`Usage: node scripts/oracle-lab.ts <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
process.loadEnvFile(ENV_FILE);
commands[cmd]().catch((e) => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
