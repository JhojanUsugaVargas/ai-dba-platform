import { Pool } from 'pg';

/**
 * Collect PostgreSQL performance metrics.
 * This is a simplified example that queries pg_stat_activity and returns a JSON summary.
 */
export async function collectPostgresMetrics(): Promise<any> {
  const pool = new Pool({
    connectionString: process.env.PG_CONNECTION_STRING,
  });
  try {
    const client = await pool.connect();
    const res = await client.query(`
      SELECT
        count(*) AS total_sessions,
        sum(CASE WHEN state = 'active' THEN 1 ELSE 0 END) AS active_sessions,
        avg(EXTRACT(EPOCH FROM now() - query_start)) AS avg_query_seconds
      FROM pg_stat_activity;
    `);
    client.release();
    return {
      totalSessions: Number(res.rows[0].total_sessions),
      activeSessions: Number(res.rows[0].active_sessions),
      avgQuerySeconds: Number(res.rows[0].avg_query_seconds),
    };
  } finally {
    await pool.end();
  }
}
