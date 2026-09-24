// Verifies against the Oracle dictionary — not against configuration — what each identity can really do.
import type { PermissionReport } from '../../core/types.ts';
import type { OraConnections } from './connection.ts';

// System privileges that would let an identity change data, structures or the instance.
const DANGEROUS = /(\bANY\b|^ALTER SYSTEM|^ALTER DATABASE|^SYSDBA|^SYSOPER|^SYSBACKUP|^SYSDG|^SYSKM|^CREATE |^DROP |^GRANT |^BECOME|^EXEMPT|^ADMINISTER|^AUDIT SYSTEM|^FLASHBACK|^LOGMINING|^RESTRICTED SESSION)/;
const WRITE_OBJ = ['INSERT', 'UPDATE', 'DELETE', 'ALTER', 'INDEX', 'EXECUTE', 'WRITE', 'MERGE VIEW', 'FLASHBACK', 'DEBUG', 'INHERIT PRIVILEGES'];
const POWER_ROLES = ['DBA', 'RESOURCE', 'IMP_FULL_DATABASE', 'DATAPUMP_IMP_FULL_DATABASE', 'EXP_FULL_DATABASE', 'SYSBACKUP', 'SCHEDULER_ADMIN', 'AQ_ADMINISTRATOR_ROLE', 'PDB_DBA', 'CDB_DBA'];

async function privileges(conn: OraConnections, grantee: string) {
  const [sys, roles, objs] = await Promise.all([
    // Direct and role-inherited system privileges.
    conn.ro(`SELECT DISTINCT privilege FROM dba_sys_privs WHERE grantee = :g
             OR grantee IN (SELECT granted_role FROM dba_role_privs START WITH grantee = :g CONNECT BY PRIOR granted_role = grantee)`, { g: grantee }),
    conn.ro(`SELECT DISTINCT granted_role FROM dba_role_privs START WITH grantee = :g CONNECT BY PRIOR granted_role = grantee`, { g: grantee }),
    conn.ro(`SELECT owner, table_name, privilege FROM dba_tab_privs WHERE grantee = :g ORDER BY owner, table_name, privilege`, { g: grantee }),
  ]);
  return {
    sys: sys.map((r) => String(r.PRIVILEGE)),
    roles: roles.map((r) => String(r.GRANTED_ROLE)),
    objs: objs.map((r) => ({ owner: String(r.OWNER), name: String(r.TABLE_NAME), priv: String(r.PRIVILEGE) })),
  };
}

export async function validateOraRo(conn: OraConnections): Promise<PermissionReport> {
  const [me] = await conn.ro(`SELECT USER AS u FROM dual`);
  const user = String(me.U);
  const p = await privileges(conn, user);
  const dangerous = p.sys.filter((s) => s !== 'CREATE SESSION' && DANGEROUS.test(s));
  const writes = p.objs.filter((o) => WRITE_OBJ.includes(o.priv));
  const powerRoles = p.roles.filter((r) => POWER_ROLES.includes(r));
  const reads = p.objs.filter((o) => o.priv === 'SELECT' || o.priv === 'READ');
  const checks = [
    { id: 'no_power_roles', description: 'Not granted DBA/RESOURCE/import/export or other administrative roles', ok: powerRoles.length === 0, observed: powerRoles, critical: true },
    { id: 'no_dangerous_sys_privs', description: 'No ANY / ALTER SYSTEM / CREATE / DROP / SYS* system privileges', ok: dangerous.length === 0, observed: dangerous, critical: true },
    { id: 'no_write_object_privs', description: 'No INSERT/UPDATE/DELETE/ALTER/INDEX/EXECUTE object grants', ok: writes.length === 0, observed: writes.map((o) => `${o.priv} ${o.owner}.${o.name}`), critical: true },
    { id: 'catalog_access', description: 'Has SELECT_CATALOG_ROLE (dictionary and V$ views)', ok: p.roles.includes('SELECT_CATALOG_ROLE') || p.sys.includes('SELECT ANY DICTIONARY'), observed: p.roles, critical: false },
    { id: 'read_only_txn', description: 'Every platform statement runs inside SET TRANSACTION READ ONLY (enforced by the adapter)', ok: true, observed: 'SET TRANSACTION READ ONLY', critical: false },
  ];
  return {
    identity: 'ro',
    user,
    verdict: checks.every((c) => c.ok || !c.critical) ? 'OK' : 'REFUSED',
    checks,
    capabilities: [`SELECT on ${reads.length} objects (needed for registered probes)`, ...p.roles.filter((r) => r === 'SELECT_CATALOG_ROLE')],
  };
}

export async function validateOraExec(conn: OraConnections, execUser: string): Promise<PermissionReport> {
  const loginUser = await conn.execIdentityCheck();
  const user = execUser.toUpperCase();
  const p = await privileges(conn, user);
  const extraSys = p.sys.filter((s) => s !== 'CREATE SESSION');
  const dml = p.objs.filter((o) => ['INSERT', 'UPDATE', 'DELETE', 'ALTER', 'INDEX'].includes(o.priv));
  const reads = p.objs.filter((o) => o.priv === 'SELECT' || o.priv === 'READ');
  const execs = p.objs.filter((o) => o.priv === 'EXECUTE');
  const checks = [
    { id: 'login', description: 'Exec identity can authenticate', ok: loginUser === user, observed: loginUser, critical: true },
    { id: 'no_roles', description: 'No roles granted (only explicit grants)', ok: p.roles.length === 0, observed: p.roles, critical: true },
    { id: 'only_create_session', description: 'No system privilege other than CREATE SESSION (no ANALYZE ANY)', ok: extraSys.length === 0, observed: extraSys, critical: true },
    { id: 'no_dml', description: 'No INSERT/UPDATE/DELETE/ALTER/INDEX on any object', ok: dml.length === 0, observed: dml.map((o) => `${o.priv} ${o.owner}.${o.name}`), critical: true },
    { id: 'no_data_read', description: 'Cannot read business data (no SELECT grants)', ok: reads.length === 0, observed: reads.map((o) => `${o.owner}.${o.name}`), critical: false },
  ];
  return {
    identity: 'exec',
    user,
    verdict: checks.every((c) => c.ok || !c.critical) ? 'OK' : 'REFUSED',
    checks,
    capabilities: execs.map((o) => `EXECUTE:${o.owner}.${o.name}`),
  };
}
