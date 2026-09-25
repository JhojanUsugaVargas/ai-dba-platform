/**
 * Simple HTTP server for the combined AI DBA Monitor project.
 * This is a placeholder that starts an Express server exposing two routes:
 *  - GET /health   – returns a basic health check JSON.
 *  - GET /metrics  – returns dummy performance metrics.
 */
import express from 'express';
import { collectPostgresMetrics } from './collectors/postgresCollector';
import { collectMssqlMetrics } from './collectors/mssqlCollector';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/metrics', async (req, res) => {
  try {
    const [pgMetrics, mssqlMetrics] = await Promise.all([
      collectPostgresMetrics(),
      collectMssqlMetrics(),
    ]);
    res.json({ postgres: pgMetrics, mssql: mssqlMetrics });
  } catch (err) {
    console.error('Metrics collection error:', err);
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

app.listen(PORT, () => {
  console.log(`AI DBA Monitor listening on http://localhost:${PORT}`);
});
