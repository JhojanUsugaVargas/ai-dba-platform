/**
 * AI DBA Platform – Express server.
 * Exposes health, metrics collection, data-quality checks, and AI analysis.
 */
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { collectPostgresMetrics } from './collectors/postgresCollector';
import { collectMssqlMetrics } from './collectors/mssqlCollector';
import { collectMongoMetrics } from './collectors/mongoCollector';
import { collectRedisMetrics } from './collectors/redisCollector';
import { DataCheckService } from './datacheck/datacheck.service';
import { analyzeReport } from './ai/analyze';
import { askSqlAssistant } from './ai/chat';
import { datacheckRouter } from './routes/datacheckRouter';
import { verifyToken, loginHandler } from './auth/auth';

const app = express();
const PORT = process.env.PORT ?? 3000;

// Middleware
app.use(cors());
app.use(express.json());

// GET /health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/login', loginHandler);
app.post('/login', loginHandler); // Provide both just in case

// Protect remaining routes
app.use(verifyToken);
app.use(datacheckRouter);

const SERVERS_FILE = path.join(__dirname, 'config', 'servers.json');

app.get('/servers', (req, res) => {
  try {
    const data = fs.readFileSync(SERVERS_FILE, 'utf-8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: 'Failed to read servers.json' });
  }
});

// GET /metrics – collect from dynamic servers
app.get('/metrics', async (_req, res) => {
  try {
    const serversData = fs.readFileSync(SERVERS_FILE, 'utf-8');
    const servers = JSON.parse(serversData);
    
    const metricPromises = servers.map(async (s: any) => {
      let metrics;
      if (s.type === 'postgres') {
        metrics = await collectPostgresMetrics(s.connectionString);
      } else if (s.type === 'mssql') {
        metrics = await collectMssqlMetrics(s.connectionString);
      } else if (s.type === 'mongodb') {
        metrics = await collectMongoMetrics(s.connectionString);
      } else if (s.type === 'redis') {
        metrics = await collectRedisMetrics(s.connectionString);
      }
      return { serverId: s.id, name: s.name, type: s.type, metrics };
    });

    const results = await Promise.all(metricPromises);
    res.json(results);
  } catch (err) {
    console.error('Metrics collection error:', err);
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

// POST /analyze – combine metrics + data-quality check, then call AI
app.post('/analyze', async (req, res) => {
  try {
    const serversData = fs.readFileSync(SERVERS_FILE, 'utf-8');
    const servers = JSON.parse(serversData);
    
    const metricPromises = servers.map(async (s: any) => {
      let metrics;
      if (s.type === 'postgres') {
        metrics = await collectPostgresMetrics(s.connectionString);
      } else if (s.type === 'mssql') {
        metrics = await collectMssqlMetrics(s.connectionString);
      } else if (s.type === 'mongodb') {
        metrics = await collectMongoMetrics(s.connectionString);
      } else if (s.type === 'redis') {
        metrics = await collectRedisMetrics(s.connectionString);
      }
      return { serverId: s.id, name: s.name, type: s.type, metrics };
    });

    const results = await Promise.all(metricPromises);
    const metrics = results;
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
