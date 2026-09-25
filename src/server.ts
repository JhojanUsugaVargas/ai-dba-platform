/**
 * Simple HTTP server for the combined AI DBA Monitor project.
 * This is a placeholder that starts an Express server exposing two routes:
 *  - GET /health   – returns a basic health check JSON.
 *  - GET /metrics  – returns dummy performance metrics.
 */
import express from 'express';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/metrics', (req, res) => {
  // In a real implementation this would gather metrics via adapters.
  const dummyMetrics = {
    cpuUsage: Math.random().toFixed(2),
    memoryUsageMb: (Math.random() * 1024).toFixed(0),
    activeConnections: Math.floor(Math.random() * 100),
  };
  res.json(dummyMetrics);
});

app.listen(PORT, () => {
  console.log(`AI DBA Monitor listening on http://localhost:${PORT}`);
});
