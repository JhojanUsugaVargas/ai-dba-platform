// Verifies - against the server, not against configuration - that each identity has exactly the intended privileges.
// All checks run on the RO identity; the exec identity only performs a login check.
import type { PermissionReport } from '../../core/types.ts';
import type { PgConnections } from './connection.ts';

const USER_TABLES = `
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'`;

export async function validateRo(conn: PgConnections): Promise<PermissionReport> {
  const [r] = await conn.ro(`
    SELECT current_user AS usr, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
           pg_has_role(current_user, 'pg_monitor', 'USAGE')              AS has_monitor,
           pg_has_role(current_user, 'pg_write_all_data', 'USAGE')       AS write_all,
           pg_has_role(current_user, 'pg_write_server_files', 'USAGE')   AS write_files,
           pg_has_role(current_user, 'pg_execute_server_program', 'USAGE') AS exec_program,
           current_setting('default_transaction_read_only')              AS default_ro,
           has_database_privilege(current_database(), 'CREATE')          AS db_create,
           has_database_privilege(current_database(), 'TEMP')            AS db_temp,
           (SELECT count(*) FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
              AND has_schema_privilege(n.oid, 'CREATE'))                  AS schemas_with_create,
           (SELECT count(*) ${USER_TABLES} AND (has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE')
              OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE'))) AS writable_tables,
           (SELECT count(*) ${USER_TABLES} AND has_table_privilege(c.oid, 'SELECT')) AS readable_tables
    FROM pg_roles r WHERE r.rolname = current_user`);
  const checks = [
    { id: 'not_superuser', description: 'Is not superuser', ok: !r.rolsuper, observed: r.rolsuper, critical: true },
    { id: 'no_role_admin', description: 'Cannot create roles or databases, no replication, no BYPASSRLS', ok: !r.rolcreaterole && !r.rolcreatedb && !r.rolreplication && !r.rolbypassrls, observed: { createrole: r.rolcreaterole, createdb: r.rolcreatedb, replication: r.rolreplication, bypassrls: r.rolbypassrls }, critical: true },
    { id: 'no_write_roles', description: 'Not member of pg_write_all_data / pg_write_server_files / pg_execute_server_program', ok: !r.write_all && !r.write_files && !r.exec_program, observed: { write_all: r.write_all, write_files: r.write_files, exec_program: r.exec_program }, critical: true },
    { id: 'no_writable_tables', description: 'Has no INSERT/UPDATE/DELETE/TRUNCATE on any user table', ok: Number(r.writable_tables) === 0, observed: Number(r.writable_tables), critical: true },
    { id: 'no_create', description: 'Cannot CREATE in the database or any schema', ok: !r.db_create && Number(r.schemas_with_create) === 0, observed: { database: r.db_create, schemas: Number(r.schemas_with_create) }, critical: true },
    { id: 'default_read_only', description: 'default_transaction_read_only = on for this role', ok: r.default_ro === 'on', observed: r.default_ro, critical: true },
    { id: 'pg_monitor', description: 'Member of pg_monitor (needed to read statistics views)', ok: r.has_monitor, observed: r.has_monitor, critical: false },
    { id: 'no_temp', description: 'Cannot create temporary tables', ok: !r.db_temp, observed: r.db_temp, critical: false },
  ];
  return {
    identity: 'ro',
    user: r.usr,
    verdict: checks.every((c) => c.ok || !c.critical) ? 'OK' : 'REFUSED',
    checks,
    capabilities: [`SELECT on ${r.readable_tables} user tables (needed for EXPLAIN of registered probes)`, ...(r.has_monitor ? ['pg_monitor'] : [])],
  };
}

export async function validateExec(conn: PgConnections, execUser: string): Promise<PermissionReport> {
  const loginUser = await conn.execIdentityCheck();
  const [r] = await conn.ro(
    `SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
            pg_has_role($1, 'pg_write_all_data', 'USAGE') AS write_all,
            pg_has_role($1, 'pg_read_all_data', 'USAGE')  AS read_all,
            (SELECT count(*) ${USER_TABLES} AND (has_table_privilege($1, c.oid, 'INSERT') OR has_table_privilege($1, c.oid, 'UPDATE')
               OR has_table_privilege($1, c.oid, 'DELETE') OR has_table_privilege($1, c.oid, 'TRUNCATE'))) AS writable_tables,
            (SELECT count(*) ${USER_TABLES} AND has_table_privilege($1, c.oid, 'SELECT')) AS readable_tables,
            (SELECT coalesce(json_agg(n.nspname || '.' || c.relname ORDER BY n.nspname, c.relname), '[]') ${USER_TABLES}
               AND has_table_privilege($1, c.oid, 'MAINTAIN')) AS maintain_tables
     FROM pg_roles r WHERE r.rolname = $1`,
    [execUser],
  );
  const checks = [
    { id: 'login', description: 'Exec identity can authenticate', ok: loginUser === execUser, observed: loginUser, critical: true },
    { id: 'not_superuser', description: 'Is not superuser', ok: !r.rolsuper, observed: r.rolsuper, critical: true },
    { id: 'no_role_admin', description: 'Cannot create roles or databases, no replication, no BYPASSRLS', ok: !r.rolcreaterole && !r.rolcreatedb && !r.rolreplication && !r.rolbypassrls, observed: null, critical: true },
    { id: 'no_dml', description: 'Has no INSERT/UPDATE/DELETE/TRUNCATE on any user table', ok: Number(r.writable_tables) === 0 && !r.write_all, observed: Number(r.writable_tables), critical: true },
    { id: 'no_data_read', description: 'Cannot read business data (SELECT)', ok: Number(r.readable_tables) === 0 && !r.read_all, observed: Number(r.readable_tables), critical: false },
  ];
  return {
    identity: 'exec',
    user: execUser,
    verdict: checks.every((c) => c.ok || !c.critical) ? 'OK' : 'REFUSED',
    checks,
    capabilities: (r.maintain_tables as string[]).map((t) => `MAINTAIN:${t}`),
  };
}
