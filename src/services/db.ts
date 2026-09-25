import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'metrics.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    db.run(`CREATE TABLE IF NOT EXISTS metric_history (
      id INTEGER PRIMARY KEY,
      server_id TEXT,
      cpu REAL,
      memory REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
});

export function saveMetric(serverId: string, cpu: number, memory: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare('INSERT INTO metric_history (server_id, cpu, memory) VALUES (?, ?, ?)');
    stmt.run([serverId, cpu, memory], function (err) {
      if (err) reject(err);
      else resolve();
    });
    stmt.finalize();
  });
}

export function getHistory(serverId: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM metric_history WHERE server_id = ? ORDER BY created_at ASC', [serverId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}
