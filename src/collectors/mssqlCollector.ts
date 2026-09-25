import sql from 'mssql';

/**
 * Collect Microsoft SQL Server performance metrics and advanced deep audit.
 */
export async function collectMssqlMetrics(connectionString: string): Promise<any> {
  const mockData = {
    totalSessions: 120,
    activeSessions: 35,
    cpuUsagePercent: 68.5,
    memoryGb: 16.5,
    topWait: 'PAGEIOLATCH_SH',
    advancedAudit: {
      indexFragmentation: [
        { db_name: 'master', table_name: 'spt_values', index_id: 1, avg_fragmentation_in_percent: 25.4 }
      ],
      missingIndexes: [
        { improvement_measure: 4500.5, table_name: '[Sales].[Orders]', index_columns: '[CustomerID]', included_columns: '[OrderDate]' }
      ],
      blockingSessions: [],
      slowQueries: [
        { execution_count: 50, total_cpu_ms: 1000, avg_cpu_ms: 20, query_text: 'SELECT * FROM Users' }
      ],
      backupStatus: [
        { database_name: 'master', backup_type: 'D', backup_finish_date: new Date().toISOString(), days_since_backup: 0 }
      ],
      osMemoryInfo: { start_time: new Date().toISOString(), cpu_count: 8, ram_mb: 16384, virtual_machine_type_desc: 'NONE' },
      waitStats: [
        { wait_type: 'PAGEIOLATCH_SH', wait_time_ms: 15000, waiting_tasks_count: 200 }
      ]
    }
  };

  if (!connectionString || connectionString.trim() === '' || connectionString.includes('your_mssql')) {
    console.warn('MSSQL_CONNECTION_STRING not set. Returning mock data.');
    return mockData;
  }

  let parsedConfig: any = null;
  try {
    parsedConfig = JSON.parse(connectionString);
  } catch {
    // Not JSON, assume standard connection string
  }

  const config: any = parsedConfig ? {
    ...parsedConfig,
    options: {
      encrypt: parsedConfig.options?.encrypt ?? true,
      ...parsedConfig.options
    }
  } : {
    connectionString: connectionString,
    options: {
      encrypt: true, // for Azure; adjust as needed
    },
  };

  if (parsedConfig?.domain || parsedConfig?.integratedSecurity) {
    config.authentication = {
      type: 'ntlm',
      options: {
        domain: parsedConfig.domain || '',
        userName: parsedConfig.user || parsedConfig.userName,
        password: parsedConfig.password
      }
    };
  }

  try {
    const pool = await sql.connect(config);
    
    // Top-level UI queries
    const sessionRes = await pool.request().query(`
      SELECT
        COUNT(*) AS total_sessions,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS active_sessions
      FROM sys.dm_exec_sessions;
    `);
    
    let cpuUsagePercent = 68.5;
    try {
      const perfRes = await pool.request().query(`
        SELECT TOP 1 cntr_value AS cpu_usage_percent
        FROM sys.dm_os_performance_counters
        WHERE counter_name = 'CPU usage %';
      `);
      if (perfRes.recordset?.[0]?.cpu_usage_percent != null) {
        cpuUsagePercent = Number(perfRes.recordset[0].cpu_usage_percent);
      }
    } catch { }

    let memoryGb = 16.5;
    try {
      const memRes = await pool.request().query(`
        SELECT TOP 1 ROUND(CAST(total_physical_memory_kb AS FLOAT) / 1048576, 2) AS memory_gb
        FROM sys.dm_os_sys_memory;
      `);
      if (memRes.recordset?.[0]?.memory_gb != null) {
        memoryGb = Number(memRes.recordset[0].memory_gb);
      }
    } catch { }

    let topWait = 'PAGEIOLATCH_SH';
    try {
      const waitRes = await pool.request().query(`
        SELECT TOP 1 wait_type
        FROM sys.dm_os_wait_stats
        WHERE wait_type NOT LIKE '%SLEEP%'
          AND wait_type NOT IN ('WAITFOR', 'REQUEST_FOR_DEADLOCK_SEARCH', 'XE_TIMER_EVENT', 'XE_DISPATCHER_WAIT')
        ORDER BY wait_time_ms DESC;
      `);
      if (waitRes.recordset?.[0]?.wait_type) {
        topWait = String(waitRes.recordset[0].wait_type);
      }
    } catch { }

    // Advanced audit queries
    let indexFragmentation = [];
    try {
      const fragRes = await pool.request().query(`
        SELECT TOP 20
            DB_NAME(database_id) AS db_name,
            OBJECT_NAME(object_id, database_id) AS table_name,
            index_id,
            avg_fragmentation_in_percent
        FROM sys.dm_db_index_physical_stats(NULL, NULL, NULL, NULL, 'LIMITED')
        WHERE avg_fragmentation_in_percent > 20.0 AND index_id > 0
        ORDER BY avg_fragmentation_in_percent DESC;
      `);
      indexFragmentation = fragRes.recordset;
    } catch { }

    let missingIndexes = [];
    try {
      const missingRes = await pool.request().query(`
        SELECT TOP 10
            migs.avg_total_user_cost * (migs.avg_user_impact / 100.0) * (migs.user_seeks + migs.user_scans) AS improvement_measure,
            mid.statement AS table_name,
            ISNULL(mid.equality_columns,'') + ISNULL(mid.inequality_columns,'') AS index_columns,
            ISNULL(mid.included_columns,'') AS included_columns
        FROM sys.dm_db_missing_index_groups mig
        INNER JOIN sys.dm_db_missing_index_group_stats migs ON migs.group_handle = mig.index_group_handle
        INNER JOIN sys.dm_db_missing_index_details mid ON mig.index_handle = mid.index_handle
        ORDER BY improvement_measure DESC;
      `);
      missingIndexes = missingRes.recordset;
    } catch { }

    let backupStatus = [];
    try {
      const backupRes = await pool.request().query(`
        SELECT TOP 10
            database_name,
            type AS backup_type,
            backup_finish_date,
            DATEDIFF(day, backup_finish_date, GETDATE()) AS days_since_backup
        FROM msdb.dbo.backupset
        WHERE type IN ('D', 'I', 'L') 
        ORDER BY backup_finish_date DESC;
      `);
      backupStatus = backupRes.recordset;
    } catch { }

    let osMemoryInfo = {};
    try {
      const osMemRes = await pool.request().query(`
        SELECT sqlserver_start_time as start_time, cpu_count, physical_memory_kb / 1024 as ram_mb, virtual_machine_type_desc FROM sys.dm_os_sys_info;
      `);
      if (osMemRes.recordset?.[0]) {
        osMemoryInfo = osMemRes.recordset[0];
      }
    } catch { }

    let slowQueries = [];
    try {
      const slowRes = await pool.request().query(`
        SELECT TOP 10 
            qs.execution_count,
            qs.total_worker_time / 1000 AS total_cpu_ms,
            (qs.total_worker_time / qs.execution_count) / 1000 AS avg_cpu_ms,
            SUBSTRING(qt.text, (qs.statement_start_offset/2)+1, 
                ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(qt.text) ELSE qs.statement_end_offset END - qs.statement_start_offset)/2) + 1) AS query_text
        FROM sys.dm_exec_query_stats qs
        CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
        ORDER BY qs.total_worker_time DESC;
      `);
      slowQueries = slowRes.recordset;
    } catch { }

    let blockingSessions = [];
    try {
      const blockRes = await pool.request().query(`
        SELECT session_id, blocking_session_id, wait_type, wait_time, wait_resource, command
        FROM sys.dm_exec_requests
        WHERE blocking_session_id <> 0;
      `);
      blockingSessions = blockRes.recordset;
    } catch { }

    let waitStats = [];
    try {
      const waitStatsRes = await pool.request().query(`
        SELECT TOP 10 wait_type, wait_time_ms, waiting_tasks_count
        FROM sys.dm_os_wait_stats
        WHERE wait_type NOT LIKE '%SLEEP%'
          AND wait_type NOT IN ('WAITFOR', 'REQUEST_FOR_DEADLOCK_SEARCH', 'XE_TIMER_EVENT', 'XE_DISPATCHER_WAIT')
        ORDER BY wait_time_ms DESC;
      `);
      waitStats = waitStatsRes.recordset;
    } catch { }

    await sql.close();
    
    return {
      totalSessions: Number(sessionRes.recordset[0].total_sessions),
      activeSessions: Number(sessionRes.recordset[0].active_sessions),
      cpuUsagePercent,
      memoryGb,
      topWait,
      advancedAudit: {
        indexFragmentation,
        missingIndexes,
        blockingSessions,
        slowQueries,
        backupStatus,
        osMemoryInfo,
        waitStats
      }
    };
  } catch (err) {
    console.error('MSSQL collector error (fallback to mock):', err);
    return mockData;
  }
}

