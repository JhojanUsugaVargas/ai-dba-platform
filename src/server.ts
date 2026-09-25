/**
 * Simple HTTP server for the combined AI DBA Monitor project.
 * This is a placeholder that starts an Express server exposing two routes:
 *  - GET /health   – returns a basic health check JSON.
 *  - GET /metrics  – returns dummy performance metrics.
 */
import express from 'express';
import { collectPostgresMetrics } from './collectors/postgresCollector';
import { collectMssqlMetrics } from './collectors/mssqlCollector';
import { DataCheckService } from './datacheck/datacheck.service';
import { analyzeReport } from './ai/analyze';
import { datacheckRouter } from './routes/datacheckRouter';

// POST /analyze – combine metrics and optional data‑quality check, then call Anthropic
app.post('/analyze', async (req, res) => {
  try {
    const [pgMetrics, mssqlMetrics] = await Promise.all([
      collectPostgresMetrics(),
      collectMssqlMetrics(),
    ]);
    const metrics = { postgres: pgMetrics, mssql: mssqlMetrics };
    const data = req.body?.data ?? [];
    const dataCheck = await DataCheckService.runCheck(data);
    const aiResult = await analyzeReport({ metrics, dataCheck });
    res.json({ aiResult, metrics, dataCheck });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: 'Failed to analyze' });
  }
});


const app = express();
const PORT = process.env.PORT ?? 3000;
app.use(express.json());
app.use(datacheckRouter);

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
