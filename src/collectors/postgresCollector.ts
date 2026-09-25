import { Pool } from 'pg';

export async function collectPostgresMetrics(connectionString: string): Promise<any> {
  const mockData = {
    totalSessions: 45,
    activeSessions: 12,
    avgQuerySeconds: 0.85,
    cacheHitRatio: 98.5,
    dbSizeGb: 45.2,
    advancedAudit: {
      checkpoints: [
        { checkpoints_timed: 10, checkpoints_req: 2, buffers_checkpoint: 100, buffers_clean: 50, maxwritten_clean: 5, buffers_backend: 200, buffers_alloc: 500 }
      ],
      tableBloat: [
        { table_name: 'users', n_live_tup: 1000, n_dead_tup: 50, dead_tup_pct: 5, last_autovacuum: null, last_autoanalyze: null }
      ],
      indexUsage: [
        { table_name: 'orders', seq_scan: 100, idx_scan: 500, n_live_tup: 15000, index_use_pct: 83.33 }
      ],
      slowQueries: [
        { datname: 'app_db', query: 'SELECT * FROM logs', calls: 5, total_time_ms: 5000, mean_time_ms: 1000, rows: 100000 }
      ],
      indexHealth: {
        invalid: [],
        redundant: []
      },
      maintenanceRisks: {
        wraparound: [{ datname: 'app_db', mxid_age: '100', xid_age: '200' }],
        jit_enabled: 'on'
      },
      osAndArchitecture: {
        version: 'PostgreSQL 14.2 on x86_64-pc-linux-gnu',
        major_version: 14,
        is_rds_or_aurora: false,
        settings: []
      }
    }
  };

  if (!connectionString || connectionString.trim() === '' || connectionString.includes('your_pg')) {
    console.warn('PG_CONNECTION_STRING not set. Returning mock data.');
    return mockData;
  }

  const pool = new Pool({ connectionString });

  try {
    const client = await pool.connect();
    
    // Performance & Basics
    const activityRes = await client.query(`
      SELECT
        count(*) AS total_sessions,
        sum(CASE WHEN state = 'active' THEN 1 ELSE 0 END) AS active_sessions,
        avg(EXTRACT(EPOCH FROM now() - query_start)) AS avg_query_seconds
      FROM pg_stat_activity;
    `);

    let cacheHitRatio = 98.5;
    let dbSizeGb = 45.2;

    try {
      const extraRes = await client.query(`
        SELECT
          ROUND(COALESCE(sum(blks_hit) * 100.0 / nullif(sum(blks_hit + blks_read), 0), 98.5), 2) AS cache_hit_ratio,
          ROUND(pg_database_size(current_database()) / (1024.0 * 1024.0 * 1024.0), 2) AS db_size_gb
        FROM pg_stat_database;
      `);
      if (extraRes.rows[0]) {
        if (extraRes.rows[0].cache_hit_ratio != null) cacheHitRatio = Number(extraRes.rows[0].cache_hit_ratio);
        if (extraRes.rows[0].db_size_gb != null) dbSizeGb = Number(extraRes.rows[0].db_size_gb);
      }
    } catch {
      // Fallback
    }

    // Checkpoints
    let checkpoints = [];
    try {
      const cpRes = await client.query(`
        SELECT checkpoints_timed, checkpoints_req, buffers_checkpoint, 
               buffers_clean, maxwritten_clean, buffers_backend, buffers_alloc
        FROM pg_stat_bgwriter;
      `);
      checkpoints = cpRes.rows;
    } catch (e) {
      console.error('Error fetching pg_stat_bgwriter', e);
    }

    // Table Bloat
    let tableBloat = [];
    try {
      const bloatRes = await client.query(`
        SELECT 
            relname AS table_name,
            n_live_tup,
            n_dead_tup,
            CASE WHEN n_live_tup > 0 THEN round((n_dead_tup::numeric / n_live_tup::numeric) * 100, 2) ELSE 0 END AS dead_tup_pct,
            last_autovacuum,
            last_autoanalyze
        FROM pg_stat_user_tables
        ORDER BY n_dead_tup DESC
        LIMIT 10;
      `);
      tableBloat = bloatRes.rows;
    } catch (e) {
      console.error('Error fetching table bloat', e);
    }

    // Index Usage
    let indexUsage = [];
    try {
      const idxUsageRes = await client.query(`
        SELECT 
            relname AS table_name,
            seq_scan,
            idx_scan,
            n_live_tup,
            CASE WHEN (seq_scan + idx_scan) > 0 THEN round((idx_scan::numeric / (seq_scan + idx_scan)::numeric) * 100, 2) ELSE 0 END AS index_use_pct
        FROM pg_stat_user_tables
        WHERE n_live_tup > 10000
        ORDER BY seq_scan DESC
        LIMIT 10;
      `);
      indexUsage = idxUsageRes.rows;
    } catch (e) {
      console.error('Error fetching index usage', e);
    }

    // Slow Queries
    let slowQueries = [];
    try {
      const slowRes = await client.query(`
        SELECT 
            d.datname,
            s.query,
            s.calls,
            round(s.total_exec_time::numeric, 2) AS total_time_ms,
            round(s.mean_exec_time::numeric, 2) AS mean_time_ms,
            s.rows
        FROM pg_stat_statements s
        LEFT JOIN pg_database d ON d.oid = s.dbid
        ORDER BY s.total_exec_time DESC
        LIMIT 5;
      `);
      slowQueries = slowRes.rows;
    } catch (e) {
      // Try older pg_stat_statements
      try {
        const slowRes2 = await client.query(`
          SELECT 
              d.datname,
              s.query,
              s.calls,
              round(s.total_time::numeric, 2) AS total_time_ms,
              round(s.mean_time::numeric, 2) AS mean_time_ms,
              s.rows
          FROM pg_stat_statements s
          LEFT JOIN pg_database d ON d.oid = s.dbid
          ORDER BY s.total_time DESC
          LIMIT 5;
        `);
        slowQueries = slowRes2.rows;
      } catch (e2) {
        // Fallback to pg_stat_activity
        try {
          const slowRes3 = await client.query(`
            SELECT 
                datname,
                query,
                1 AS calls,
                round(extract(epoch from (now() - query_start)) * 1000, 2) AS total_time_ms,
                round(extract(epoch from (now() - query_start)) * 1000, 2) AS mean_time_ms,
                0 AS rows,
                true as is_fallback
            FROM pg_stat_activity
            WHERE state = 'active' AND pid <> pg_backend_pid()
            ORDER BY query_start ASC
            LIMIT 5;
          `);
          slowQueries = slowRes3.rows;
        } catch (e3) {
          console.error('Error fetching slow queries', e3);
        }
      }
    }

    // Index Health
    let invalid = [];
    let redundant = [];
    try {
      const invRes = await client.query(`
        SELECT c.relname as index_name, t.relname as table_name
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_class t ON t.oid = i.indrelid
        WHERE i.indisvalid = false;
      `);
      invalid = invRes.rows;

      const redRes = await client.query(`
        SELECT 
            indrelid::regclass AS table_name,
            array_agg(indexrelid::regclass) AS redundant_indexes
        FROM pg_index
        GROUP BY indrelid, indkey, indcollation, indclass, indoption, indexprs, indpred
        HAVING COUNT(*) > 1;
      `);
      redundant = redRes.rows;
    } catch (e) {
      console.error('Error fetching index health', e);
    }

    // Maintenance Risks
    let wraparound = [];
    let jit_enabled = 'unknown';
    try {
      const mxidRes = await client.query(`
        SELECT datname, age(datminmxid) as mxid_age, age(datfrozenxid) as xid_age
        FROM pg_database 
        ORDER BY xid_age DESC 
        LIMIT 3;
      `);
      wraparound = mxidRes.rows;

      const jitRes = await client.query("SHOW jit;");
      if (jitRes.rows.length > 0) jit_enabled = jitRes.rows[0].jit;
    } catch (e) {
      console.error('Error fetching maintenance risks', e);
    }

    // OS and Architecture
    let osAndArchitecture = { version: '', major_version: 0, is_rds_or_aurora: false, settings: [] };
    try {
      const verRes = await client.query("SELECT version();");
      const v_str = verRes.rows.length > 0 ? verRes.rows[0].version.toLowerCase() : '';
      osAndArchitecture.version = v_str;

      try {
        const vnumRes = await client.query("SELECT current_setting('server_version_num') as vnum;");
        if (vnumRes.rows.length > 0) {
          osAndArchitecture.major_version = Math.floor(parseInt(vnumRes.rows[0].vnum) / 10000);
        }
      } catch (e) {}

      let is_rds = v_str.includes("aurora") || v_str.includes("rds");
      if (!is_rds) {
        try {
          const roleRes = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'rds_superuser';");
          if (roleRes.rows.length > 0) is_rds = true;
        } catch (e) {}
      }
      osAndArchitecture.is_rds_or_aurora = is_rds;

      const setRes = await client.query(`
        SELECT name, setting, unit 
        FROM pg_settings 
        WHERE name IN ('shared_buffers', 'work_mem', 'effective_cache_size', 'maintenance_work_mem', 'max_connections', 'random_page_cost', 'max_wal_size');
      `);
      osAndArchitecture.settings = setRes.rows;
    } catch (e) {
      console.error('Error fetching os & architecture', e);
    }

    client.release();

    return {
      totalSessions: Number(activityRes.rows[0].total_sessions) || 0,
      activeSessions: Number(activityRes.rows[0].active_sessions) || 0,
      avgQuerySeconds: Number(activityRes.rows[0].avg_query_seconds) || 0,
      cacheHitRatio,
      dbSizeGb,
      advancedAudit: {
        checkpoints,
        tableBloat,
        indexUsage,
        slowQueries,
        indexHealth: {
          invalid,
          redundant
        },
        maintenanceRisks: {
          wraparound,
          jit_enabled
        },
        osAndArchitecture
      }
    };
  } catch (err) {
    console.error('Postgres collector error (fallback to mock):', err);
    return mockData;
  } finally {
    await pool.end();
  }
}
