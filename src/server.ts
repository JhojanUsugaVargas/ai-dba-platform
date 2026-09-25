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
import { collectDynamoMetrics } from './collectors/dynamoCollector';
import { DataCheckService } from './datacheck/datacheck.service';
import { analyzeReport } from './ai/analyze';
import { askSqlAssistant } from './ai/chat';
import { datacheckRouter } from './routes/datacheckRouter';
import { verifyToken, loginHandler } from './auth/auth';
import { generateCMDBPdf } from './services/pdfGenerator.js';
import { sendReportEmail } from './services/mailer.js';

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

// POST /chat & POST /api/chat – answer SQL errors or questions using Gemini
const handleChat = async (req: express.Request, res: express.Response) => {
  try {
    const question = req.body?.question || req.body?.message || '';
    const answer = await askSqlAssistant(question);
    res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: 'Failed to chat' });
  }
};

app.post('/chat', handleChat);
app.post('/api/chat', handleChat);

// Protect remaining routes
app.use(verifyToken);
app.use(datacheckRouter);

app.post('/api/reports/pdf', async (req, res) => {
  try {
    const metrics = req.body;
    const pdfBuffer = await generateCMDBPdf(metrics);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

app.post('/api/reports/email', async (req, res) => {
  try {
    const { metrics, smtp, recipient } = req.body;
    const serverName = metrics?.name || 'Unknown_Server';
    const pdfBuffer = await generateCMDBPdf(metrics);
    await sendReportEmail(smtp, recipient, pdfBuffer, serverName);
    res.json({ success: true });
  } catch (error) {
    console.error('Email sending error:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVERS_FILE = path.join(__dirname, 'config', 'servers.json');

app.get('/servers', (req, res) => {
  try {
    const data = fs.readFileSync(SERVERS_FILE, 'utf-8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: 'Failed to read servers.json' });
  }
});

// POST /api/servers/test
app.post('/api/servers/test', async (req, res) => {
  try {
    const type = req.body.type;
    const connectionString = req.body.connectionString || req.body.credentials;
    if (type === 'postgres') await collectPostgresMetrics(connectionString);
    else if (type === 'mssql') await collectMssqlMetrics(connectionString);
    else if (type === 'mongodb') await collectMongoMetrics(connectionString);
    else if (type === 'redis') await collectRedisMetrics(connectionString);
    else if (type === 'dynamodb') await collectDynamoMetrics(connectionString);
    else throw new Error('Unknown server type');
    res.json({ success: true, message: 'Connection successful' });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

// POST /api/servers
app.post('/api/servers', (req, res) => {
  try {
    const data = fs.readFileSync(SERVERS_FILE, 'utf-8');
    const servers = JSON.parse(data);
    const newServer = { id: Date.now().toString(), ...req.body };
    servers.push(newServer);
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2));
    res.json(newServer);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add server' });
  }
});

// DELETE /api/servers/:id
app.delete('/api/servers/:id', (req, res) => {
  try {
    const data = fs.readFileSync(SERVERS_FILE, 'utf-8');
    let servers = JSON.parse(data);
    servers = servers.filter((s: any) => s.id !== req.params.id);
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete server' });
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
      } else if (s.type === 'dynamodb') {
        metrics = await collectDynamoMetrics(s.connectionString);
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
      } else if (s.type === 'dynamodb') {
        metrics = await collectDynamoMetrics(s.connectionString);
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

app.listen(PORT, () => {
  console.log(`AI DBA Monitor listening on http://localhost:${PORT}`);
});

export default app;
