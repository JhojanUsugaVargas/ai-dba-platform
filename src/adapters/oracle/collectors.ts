// Oracle collectors (19c+). Licensing-safe by design: no AWR / ASH / DBA_HIST_* (Diagnostics Pack) and no SQL Tuning
// Advisor (Tuning Pack). Only V$ views and DBA_* dictionary views available in every edition, read through
// SELECT_CATALOG_ROLE, inside SET TRANSACTION READ ONLY, each with its own call timeout.
import type { CollectorDef, EvidenceDraft, Target } from '../../core/types.ts';
import type { OraConnections } from './connection.ts';
import { loadOraProbes, runOraProbe } from './probes.ts';
import { LocalHostAdapter } from '../../infra/local.ts';

const PARAMS = [
  'sga_target', 'sga_max_size', 'pga_aggregate_target', 'pga_aggregate_limit', 'memory_target', 'processes', 'sessions',
  'optimizer_features_enable', 'optimizer_adaptive_plans', 'optimizer_adaptive_statistics', 'statistics_level',
  'control_management_pack_access', 'db_recovery_file_dest_size', 'cpu_count', 'db_block_size', 'undo_retention', 'audit_trail',
];
const NON_PLATFORM = `NVL(s.module, '-') <> 'ai-dba-platform'`;

export function oracleCollectors(conn: OraConnections, target: Target, root: string, disabled: Set<string>): CollectorDef[] {
  const def = (c: Omit<CollectorDef, 'enabled'>): CollectorDef => ({ ...c, enabled: !disabled.has(c.id) });
  const one = (source: string, data: unknown): EvidenceDraft[] => [{ source, data }];

  return [
    def({
      id: 'instance', title: 'Instance, database role and log mode', dimensions: ['Availability', 'Backups'], timeoutMs: 3000, identity: 'ro',
      run: async () => one('v$instance, v$database', (await conn.ro(`
        SELECT i.instance_name, i.host_name, i.version_full, i.status AS instance_status, i.startup_time,
               ROUND((SYSDATE - i.startup_time) * 86400) AS uptime_s,
               d.name AS db_name, d.log_mode, d.database_role, d.open_mode, d.force_logging, d.flashback_on, d.cdb,
               SYS_CONTEXT('USERENV','CON_NAME') AS con_name
        FROM v$instance i CROSS JOIN v$database d`))[0]),
    }),
    def({
      id: 'parameters', title: 'Initialization parameters', dimensions: ['Configuration'], timeoutMs: 3000, identity: 'ro',
      run: async () => {
        const rows = await conn.ro(`SELECT name, value, isdefault FROM v$parameter WHERE name IN (${PARAMS.map((_, i) => `:p${i}`).join(',')})`, Object.fromEntries(PARAMS.map((p, i) => [`p${i}`, p])));
        return one('v$parameter', Object.fromEntries(rows.map((r) => [r.NAME, { value: r.VALUE, isdefault: r.ISDEFAULT }])));
      },
    }),
    def({
      id: 'sessions', title: 'Sessions, active sessions by wait class, resource limits', dimensions: ['Availability', 'Performance'], timeoutMs: 3000, identity: 'ro',
      run: async () => one('v$session, v$resource_limit', {
        byState: await conn.ro(`
          SELECT bucket, COUNT(*) AS n FROM (
            SELECT CASE WHEN s.status = 'ACTIVE' AND s.state <> 'WAITING' THEN 'ON CPU'
                        WHEN s.status = 'ACTIVE' AND s.wait_class <> 'Idle' THEN s.wait_class
                        ELSE 'INACTIVE / IDLE' END AS bucket
            FROM v$session s WHERE s.type = 'USER' AND ${NON_PLATFORM})
          GROUP BY bucket`),
        limits: await conn.ro(`SELECT resource_name, current_utilization, max_utilization, TRIM(limit_value) AS limit_value FROM v$resource_limit WHERE resource_name IN ('processes','sessions')`),
      }),
    }),
    def({
      id: 'blocking', title: 'Blocking chains (enqueue waits)', dimensions: ['Availability', 'Performance'], timeoutMs: 3000, identity: 'ro',
      run: async () => one('v$session (blocking_session)', await conn.ro(`
        SELECT s.sid, s.serial#, s.username, s.event, s.wait_class, ROUND(s.wait_time_micro / 1e6) AS wait_s,
               s.blocking_session, s.blocking_session_status, s.sql_id, s.module
        FROM v$session s WHERE s.blocking_session IS NOT NULL AND ${NON_PLATFORM}
        ORDER BY s.wait_time_micro DESC FETCH FIRST 25 ROWS ONLY`)),
    }),
    def({
      id: 'tablespaces', title: 'Tablespace usage', dimensions: ['Storage'], timeoutMs: 5000, identity: 'ro',
      run: async () => one('dba_tablespace_usage_metrics, dba_tablespaces', await conn.ro(`
        SELECT m.tablespace_name, ROUND(m.used_percent, 1) AS used_percent, m.used_space * t.block_size AS used_bytes,
               m.tablespace_size * t.block_size AS max_bytes, t.contents
        FROM dba_tablespace_usage_metrics m JOIN dba_tablespaces t ON t.tablespace_name = m.tablespace_name
        ORDER BY m.used_percent DESC`)),
    }),
    def({
      id: 'recovery_area', title: 'Fast Recovery Area usage', dimensions: ['Storage', 'Backups'], timeoutMs: 3000, identity: 'ro',
      run: async () => one('v$recovery_file_dest', (await conn.ro(`SELECT name, space_limit, space_used, space_reclaimable, number_of_files FROM v$recovery_file_dest`))[0] ?? { configured: false }),
    }),
    def({
      id: 'backups', title: 'RMAN backup history (control file)', dimensions: ['Backups'], timeoutMs: 5000, identity: 'ro',
      run: async () => one('v$rman_backup_job_details (last 30 days)', await conn.ro(`
        SELECT input_type, status, COUNT(*) AS jobs, MAX(end_time) AS last_end,
               MAX(CASE WHEN status = 'COMPLETED' THEN end_time END) AS last_success
        FROM v$rman_backup_job_details WHERE start_time > SYSDATE - 30 GROUP BY input_type, status`)),
    }),
    def({
      id: 'statistics', title: 'Optimizer statistics: staleness, locks, pending statistics, preferences', dimensions: ['Performance', 'Maintenance'], timeoutMs: 8000, identity: 'ro',
      run: async () => one('dba_tab_statistics, dba_tab_modifications, dba_tab_pending_stats, DBMS_STATS.GET_PREFS', await conn.ro(`
        SELECT s.owner, s.table_name, s.num_rows, s.blocks, s.last_analyzed, s.stale_stats, s.stattype_locked,
               m.inserts, m.updates, m.deletes, m.timestamp AS modified_at,
               (SELECT COUNT(*) FROM dba_tab_pending_stats p WHERE p.owner = s.owner AND p.table_name = s.table_name AND p.partition_name IS NULL) AS pending_count,
               (SELECT MAX(p.last_analyzed) FROM dba_tab_pending_stats p WHERE p.owner = s.owner AND p.table_name = s.table_name) AS pending_analyzed,
               DBMS_STATS.GET_PREFS('STALE_PERCENT', s.owner, s.table_name) AS stale_percent,
               DBMS_STATS.GET_PREFS('PUBLISH', s.owner, s.table_name) AS publish_pref
        FROM dba_tab_statistics s
        JOIN dba_users u ON u.username = s.owner AND u.oracle_maintained = 'N'
        LEFT JOIN dba_tab_modifications m ON m.table_owner = s.owner AND m.table_name = s.table_name AND m.partition_name IS NULL
        WHERE s.object_type = 'TABLE' AND s.owner NOT LIKE 'APEX%'
        ORDER BY NVL(s.num_rows, 0) DESC FETCH FIRST 50 ROWS ONLY`)),
    }),
    def({
      id: 'autotask', title: 'Automatic maintenance tasks', dimensions: ['Maintenance'], timeoutMs: 3000, identity: 'ro',
      run: async () => one('dba_autotask_client', await conn.ro(`SELECT client_name, status FROM dba_autotask_client`)),
    }),
    def({
      id: 'top_sql', title: 'Top SQL by elapsed time (cursor cache)', dimensions: ['Performance'], timeoutMs: 5000, identity: 'ro',
      run: async () => one('v$sql (cursor cache, no AWR)', await conn.ro(`
        SELECT sql_id, SUM(executions) AS executions, ROUND(SUM(elapsed_time) / 1000) AS elapsed_ms, ROUND(SUM(cpu_time) / 1000) AS cpu_ms,
               SUM(buffer_gets) AS buffer_gets, MAX(parsing_schema_name) AS schema_name, MAX(SUBSTR(sql_text, 1, 300)) AS sql_text
        FROM v$sql WHERE parsing_schema_name NOT IN ('SYS','SYSTEM') AND UPPER(sql_text) NOT LIKE '%AIDBA-PROBE%' AND NVL(module, '-') <> 'ai-dba-platform'
        GROUP BY sql_id ORDER BY 3 DESC FETCH FIRST 10 ROWS ONLY`)),
    }),
    def({
      id: 'replication', title: 'Data Guard destinations', dimensions: ['Replication'], timeoutMs: 3000, identity: 'ro',
      run: async () => {
        const dests = await conn.ro(`
          SELECT d.dest_id, d.destination, d.target, s.status, s.type, s.database_mode, s.recovery_mode, s.gap_status, s.error
          FROM v$archive_dest d JOIN v$archive_dest_status s ON s.dest_id = d.dest_id
          WHERE d.target = 'STANDBY' AND d.status <> 'INACTIVE'`);
        const [role] = await conn.ro(`SELECT database_role FROM v$database`);
        return one('v$archive_dest, v$archive_dest_status, v$database', { configured: dests.length > 0 || role.DATABASE_ROLE !== 'PRIMARY', role: role.DATABASE_ROLE, destinations: dests });
      },
    }),
    def({
      id: 'security', title: 'Default passwords and powerful grants', dimensions: ['Security'], timeoutMs: 4000, identity: 'ro',
      run: async () => one('dba_users_with_defpwd, dba_users, dba_role_privs', {
        defaultPasswordOpen: (await conn.ro(`SELECT d.username FROM dba_users_with_defpwd d JOIN dba_users u ON u.username = d.username WHERE u.account_status = 'OPEN'`)).map((r) => r.USERNAME),
        dbaGrantees: (await conn.ro(`SELECT r.grantee FROM dba_role_privs r JOIN dba_users u ON u.username = r.grantee WHERE r.granted_role = 'DBA' AND u.oracle_maintained = 'N'`)).map((r) => r.GRANTEE),
      }),
    }),
    def({
      id: 'probes', title: 'Registered critical query probes (ALLSTATS: E-Rows vs A-Rows, read-only)', dimensions: ['Performance'], timeoutMs: 120000, identity: 'ro',
      run: async () => {
        const out: EvidenceDraft[] = [];
        for (const p of loadOraProbes(root)) {
          out.push({ source: `V$SQL_PLAN_STATISTICS_ALL for registered probe "${p.id}" [SET TRANSACTION READ ONLY, GATHER_PLAN_STATISTICS]`, data: await runOraProbe(conn, p) });
          // If any table of the probe has pending statistics, validate them in an isolated session (nobody else sees them).
          const tables = p.tables.map((t) => t.split('.').map((x) => x.toUpperCase()));
          const pending = await conn.ro(`SELECT COUNT(*) AS n FROM dba_tab_pending_stats WHERE (owner, table_name) IN (${tables.map((_, i) => `(:o${i}, :t${i})`).join(',')})`,
            Object.fromEntries(tables.flatMap(([o, t], i) => [[`o${i}`, o], [`t${i}`, t]])));
          if (Number(pending[0].N) > 0)
            out.push({ source: `Probe "${p.id}" with optimizer_use_pending_statistics=TRUE (isolated session, dropped afterwards)`, data: await runOraProbe(conn, p, { pending: true }) });
        }
        return out;
      },
    }),
    def({
      id: 'host', title: 'Host resources (local host only)', dimensions: ['Storage', 'Availability'], timeoutMs: 3000, identity: 'host',
      run: async () => {
        const infra = new LocalHostAdapter();
        if (!infra.appliesTo(target.host)) return one('InfrastructureAdapter', { unavailable: 'Target is not on this host; remote host metrics need an infrastructure agent (not in Build Day scope).' });
        return one('node:os', await infra.snapshot(null));
      },
    }),
  ];
}
