/**
 * AI DBA Platform – Express server.
 * Exposes health, metrics collection, data-quality checks, and AI analysis.
 */
import express from 'express';
import cors from 'cors';
import { collectPostgresMetrics } from './collectors/postgresCollector';
import { collectMssqlMetrics } from './collectors/mssqlCollector';
import { DataCheckService } from './datacheck/datacheck.service';
import { analyzeReport } from './ai/analyze';
import { askSqlAssistant } from './ai/chat';
import { datacheckRouter } from './routes/datacheckRouter';

const app = express();
const PORT = process.env.PORT ?? 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(datacheckRouter);

// GET /health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /metrics – collect from both PostgreSQL and MSSQL
app.get('/metrics', async (_req, res) => {
  try {
    const [postgres, mssql] = await Promise.all([
      collectPostgresMetrics(),
      collectMssqlMetrics(),
    ]);
    res.json({ postgres, mssql });
  } catch (err) {
    console.error('Metrics collection error:', err);
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

// POST /analyze – combine metrics + data-quality check, then call AI
app.post('/analyze', async (req, res) => {
  try {
    const [postgres, mssql] = await Promise.all([
      collectPostgresMetrics(),
      collectMssqlMetrics(),
    ]);
    const metrics = { postgres, mssql };
    const data = req.body?.data ?? [];
    const dataCheck = await DataCheckService.runCheck(data);
    const aiResult = await analyzeReport({ metrics, dataCheck });
    res.json({ aiResult, metrics, dataCheck });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: 'Failed to analyze' });
  }
});

// POST /chat & POST /api/chat – answer SQL errors or questions using Gemini
const handleChat = async (req: express.Request, res: express.Response) => {
  try {
    const question = req.body?.question || '';
    const answer = await askSqlAssistant(question);
    res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: 'Failed to chat' });
  }
};

app.post('/chat', handleChat);
app.post('/api/chat', handleChat);

app.listen(PORT, () => {
  console.log(`AI DBA Monitor listening on http://localhost:${PORT}`);
});

export default app;
