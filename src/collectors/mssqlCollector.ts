import sql from 'mssql';

/**
 * Collect Microsoft SQL Server performance metrics.
 * This example queries sys.dm_exec_sessions and sys.dm_os_performance_counters
 * to return a simple JSON payload.
 */
export async function collectMssqlMetrics(): Promise<any> {
  if (!process.env.MSSQL_CONNECTION_STRING || process.env.MSSQL_CONNECTION_STRING.includes('your_mssql')) {
    console.warn('MSSQL_CONNECTION_STRING not set. Returning mock data.');
    return {
      totalSessions: 120,
      activeSessions: 35,
      cpuUsagePercent: 68.5,
      memoryGb: 16.5,
      topWait: 'PAGEIOLATCH_SH',
    };
  }

  const config = {
    connectionString: process.env.MSSQL_CONNECTION_STRING,
    options: {
      encrypt: true, // for Azure; adjust as needed
    },
  };

  try {
    const pool = await sql.connect(config);
    const sessionRes = await pool.request().query(`
      SELECT
        COUNT(*) AS total_sessions,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS active_sessions
      FROM sys.dm_exec_sessions;
    `);
    const perfRes = await pool.request().query(`
      SELECT TOP 1
        cntr_value AS cpu_usage_percent
      FROM sys.dm_os_performance_counters
      WHERE counter_name = 'CPU usage %';
    `);

    let memoryGb = 16.5;
    let topWait = 'PAGEIOLATCH_SH';
    try {
      const memRes = await pool.request().query(`
        SELECT TOP 1 ROUND(CAST(total_physical_memory_kb AS FLOAT) / 1048576, 2) AS memory_gb
        FROM sys.dm_os_sys_memory;
      `);
      if (memRes.recordset?.[0]?.memory_gb != null) {
        memoryGb = Number(memRes.recordset[0].memory_gb);
      }
    } catch {
      // fallback to mock value if DMV unavailable
    }

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
    } catch {
      // fallback to mock value if DMV unavailable
    }

    await sql.close();
    return {
      totalSessions: Number(sessionRes.recordset[0].total_sessions),
      activeSessions: Number(sessionRes.recordset[0].active_sessions),
      cpuUsagePercent: Number(perfRes.recordset[0].cpu_usage_percent),
      memoryGb,
      topWait,
    };
  } catch (err) {
    console.error('MSSQL collector error (fallback to mock):', err);
    return {
      totalSessions: 120,
      activeSessions: 35,
      cpuUsagePercent: 68.5,
      memoryGb: 16.5,
      topWait: 'PAGEIOLATCH_SH',
    };
  }
}
