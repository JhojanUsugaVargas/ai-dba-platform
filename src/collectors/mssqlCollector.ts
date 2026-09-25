import sql from 'mssql';

/**
 * Collect Microsoft SQL Server performance metrics.
 * This example queries sys.dm_exec_sessions and sys.dm_os_performance_counters
 * to return a simple JSON payload.
 */
export async function collectMssqlMetrics(): Promise<any> {
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
    await sql.close();
    return {
      totalSessions: Number(sessionRes.recordset[0].total_sessions),
      activeSessions: Number(sessionRes.recordset[0].active_sessions),
      cpuUsagePercent: Number(perfRes.recordset[0].cpu_usage_percent),
    };
  } catch (err) {
    console.error('MSSQL collector error:', err);
    throw err;
  }
}
