// PostgreSQL 17 collectors. Every collector: RO identity (or host API), own timeout, bounded result size,
// can be disabled. Views/columns verified against PostgreSQL 17 (e.g. pg_stat_checkpointer is new in 17).
import type { CollectorDef, EvidenceDraft, Target } from '../../core/types.ts';
import type { PgConnections } from './connection.ts';
import { loadProbes, runProbe } from './probes.ts';
import { LocalHostAdapter } from '../../infra/local.ts';

const SETTINGS = [
  'shared_buffers', 'effective_cache_size', 'work_mem', 'maintenance_work_mem', 'max_connections',
  'autovacuum', 'autovacuum_analyze_threshold', 'autovacuum_analyze_scale_factor', 'autovacuum_vacuum_scale_factor',
  'default_statistics_target', 'random_page_cost', 'wal_level', 'archive_mode', 'archive_command', 'max_wal_size',
  'checkpoint_timeout', 'ssl', 'password_encryption', 'listen_addresses', 'log_min_duration_statement',
  'track_io_timing', 'shared_preload_libraries', 'data_directory', 'server_version', 'statement_timeout',
];

export function postgresCollectors(conn: PgConnections, target: Target, root: string, disabled: Set<string>): CollectorDef[] {
  const def = (c: Omit<CollectorDef, 'enabled'>): CollectorDef => ({ ...c, enabled: !disabled.has(c.id) });
  const one = (source: string, data: unknown): EvidenceDraft[] => [{ source, data }];

  return [
    def({
      id: 'instance', title: 'Instance identity and uptime', dimensions: ['Availability'], timeoutMs: 2000, identity: 'ro',
      run: async () => one('version(), pg_postmaster_start_time(), pg_is_in_recovery()', (await conn.ro(`
        SELECT version() AS version, current_setting('server_version_num')::int AS version_num,
               pg_postmaster_start_time() AS started_at,
               extract(epoch FROM now() - pg_postmaster_start_time())::bigint AS uptime_s,
               pg_is_in_recovery() AS in_recovery`))[0]),
    }),
    def({
      id: 'settings', title: 'Configuration parameters', dimensions: ['Configuration'], timeoutMs: 2000, identity: 'ro',
      run: async () => {
        const rows = await conn.ro(`SELECT name, setting, unit, source, pending_restart FROM pg_settings WHERE name = ANY($1)`, [SETTINGS]);
        return one('pg_settings', Object.fromEntries(rows.map((r) => [r.name, { setting: r.setting, unit: r.unit, source: r.source, pending_restart: r.pending_restart }])));
      },
    }),
    def({
      id: 'databases', title: 'Database sizes and transaction ID age', dimensions: ['Storage', 'Maintenance'], timeoutMs: 3000, identity: 'ro',
      run: async () => one('pg_database, pg_database_size(), age(datfrozenxid)', await conn.ro(`
        SELECT datname, pg_database_size(oid) AS size_bytes, age(datfrozenxid) AS xid_age
        FROM pg_database WHERE datallowconn ORDER BY 2 DESC LIMIT 20`)),
    }),
    def({
      id: 'connections', title: 'Connection usage', dimensions: ['Availability'], timeoutMs: 2000, identity: 'ro',
      run: async () => one('pg_stat_activity', (await conn.ro(`
        SELECT current_setting('max_connections')::int AS max_connections,
               count(*) FILTER (WHERE backend_type = 'client backend') AS client_backends,
               count(*) FILTER (WHERE backend_type = 'client backend' AND state = 'active') AS active,
               count(*) FILTER (WHERE backend_type = 'client backend' AND state = 'idle in transaction') AS idle_in_tx,
               count(*) FILTER (WHERE application_name LIKE 'ai-dba-platform/%') AS platform_sessions
        FROM pg_stat_activity`))[0]),
    }),
    def({
      id: 'activity', title: 'Long-running queries, idle transactions and blocking', dimensions: ['Availability', 'Performance'], timeoutMs: 2000, identity: 'ro',
      run: async () => one('pg_stat_activity, pg_blocking_pids()', {
        sessions: await conn.ro(`
          SELECT pid, usename, application_name, state, wait_event_type, wait_event,
                 extract(epoch FROM now() - xact_start)::int AS xact_age_s,
                 extract(epoch FROM now() - query_start)::int AS query_age_s,
                 pg_blocking_pids(pid) AS blocked_by, left(query, 200) AS query
          FROM pg_stat_activity
          WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
            AND application_name NOT LIKE 'ai-dba-platform/%'
            AND (state IN ('active','idle in transaction','idle in transaction (aborted)') OR cardinality(pg_blocking_pids(pid)) > 0)
          ORDER BY xact_start NULLS LAST LIMIT 25`),
      }),
    }),
    def({
      id: 'tables', title: 'Table statistics freshness, dead tuples, autovacuum options', dimensions: ['Performance', 'Maintenance', 'Storage'], timeoutMs: 3000, identity: 'ro',
      run: async () => one('pg_stat_user_tables, pg_class (reloptions, reltuples)', await conn.ro(`
        SELECT s.schemaname, s.relname, s.n_live_tup, s.n_dead_tup, s.n_mod_since_analyze, s.n_ins_since_vacuum,
               s.last_analyze, s.last_autoanalyze, s.last_vacuum, s.last_autovacuum,
               s.seq_scan, s.idx_scan, c.reltuples::bigint AS reltuples, c.relpages, c.reloptions,
               pg_total_relation_size(s.relid) AS total_bytes
        FROM pg_stat_user_tables s JOIN pg_class c ON c.oid = s.relid
        ORDER BY pg_total_relation_size(s.relid) DESC LIMIT 50`)),
    }),
    def({
      id: 'statements', title: 'Top SQL by total execution time', dimensions: ['Performance'], timeoutMs: 3000, identity: 'ro',
      run: async () => {
        const ext = await conn.ro(`SELECT extversion FROM pg_extension WHERE extname = 'pg_stat_statements'`);
        if (!ext.length) return one('pg_extension', { installed: false, top: [] });
        const top = await conn.ro(`
          SELECT queryid::text, calls, round(total_exec_time::numeric, 1) AS total_ms, round(mean_exec_time::numeric, 1) AS mean_ms,
                 rows, shared_blks_hit, shared_blks_read, left(query, 400) AS query
          FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          ORDER BY total_exec_time DESC LIMIT 10`);
        return one('pg_stat_statements', { installed: true, version: ext[0].extversion, top });
      },
    }),
    def({
      id: 'db_stats', title: 'Cache efficiency, deadlocks, temp files', dimensions: ['Performance'], timeoutMs: 2000, identity: 'ro',
      run: async () => one('pg_stat_database', (await conn.ro(`
        SELECT blks_hit, blks_read, xact_commit, xact_rollback, deadlocks, temp_files, temp_bytes, conflicts, checksum_failures, stats_reset
        FROM pg_stat_database WHERE datname = current_database()`))[0]),
    }),
    def({
      id: 'checkpointer', title: 'Checkpoint behaviour', dimensions: ['Configuration'], timeoutMs: 2000, identity: 'ro',
      run: async () => one('pg_stat_checkpointer', (await conn.ro(`
        SELECT num_timed, num_requested, write_time, sync_time, buffers_written, stats_reset FROM pg_stat_checkpointer`))[0]),
    }),
    def({
      id: 'wal_archiving', title: 'WAL archiving (point-in-time recovery prerequisite)', dimensions: ['Backups'], timeoutMs: 2000, identity: 'ro',
      run: async () => one('pg_stat_archiver, pg_settings', (await conn.ro(`
        SELECT current_setting('archive_mode') AS archive_mode, current_setting('wal_level') AS wal_level,
               a.archived_count, a.last_archived_time, a.failed_count, a.last_failed_time
        FROM pg_stat_archiver a`))[0]),
    }),
    def({
      id: 'replication', title: 'Replicas and replication slots', dimensions: ['Replication', 'Storage'], timeoutMs: 2000, identity: 'ro',
      run: async () => one('pg_stat_replication, pg_replication_slots', {
        in_recovery: (await conn.ro(`SELECT pg_is_in_recovery() AS r`))[0].r,
        replicas: await conn.ro(`SELECT application_name, state, sync_state, write_lag::text, flush_lag::text, replay_lag::text FROM pg_stat_replication`),
        slots: await conn.ro(`
          SELECT slot_name, slot_type, active, wal_status,
                 CASE WHEN restart_lsn IS NOT NULL AND NOT pg_is_in_recovery()
                      THEN pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)::bigint END AS retained_bytes
          FROM pg_replication_slots`),
      }),
    }),
    def({
      id: 'security', title: 'Authentication and privilege posture', dimensions: ['Security'], timeoutMs: 2000, identity: 'ro',
      run: async () => one('pg_roles, pg_settings, has_schema_privilege()', (await conn.ro(`
        SELECT current_setting('ssl') AS ssl, current_setting('password_encryption') AS password_encryption,
               current_setting('listen_addresses') AS listen_addresses,
               (SELECT coalesce(json_agg(rolname ORDER BY rolname), '[]') FROM pg_roles WHERE rolsuper AND rolcanlogin) AS login_superusers,
               (SELECT count(*) FROM pg_roles WHERE rolcanlogin AND rolvaliduntil IS NULL AND NOT rolname LIKE 'pg\\_%') AS logins_without_expiry,
               has_schema_privilege('public', 'public', 'CREATE') AS public_can_create_in_public`))[0]),
    }),
    def({
      id: 'probes', title: 'Registered critical query probes (EXPLAIN ANALYZE, read-only)', dimensions: ['Performance'], timeoutMs: 60000, identity: 'ro',
      run: async () => {
        const out: EvidenceDraft[] = [];
        for (const p of loadProbes(root, target.database)) {
          out.push({ source: `EXPLAIN (ANALYZE, BUFFERS) registered probe "${p.id}" [READ ONLY txn, timeout ${p.timeout_ms}ms]`, data: await runProbe(conn, p) });
        }
        return out;
      },
    }),
    def({
      id: 'host', title: 'Host resources (local host only)', dimensions: ['Storage', 'Availability'], timeoutMs: 3000, identity: 'host',
      run: async () => {
        const infra = new LocalHostAdapter();
        if (!infra.appliesTo(target.host)) return one('InfrastructureAdapter', { unavailable: 'Target is not on this host; remote host metrics need an infrastructure agent (not in Build Day scope).' });
        const [{ data_directory }] = await conn.ro(`SELECT current_setting('data_directory') AS data_directory`);
        return one('node:os, fs.statfs(data_directory)', await infra.snapshot(data_directory));
      },
    }),
  ];
}
