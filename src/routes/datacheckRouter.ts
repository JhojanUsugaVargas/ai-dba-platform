import { Router, Request, Response } from 'express';
import { DataCheckService } from '../datacheck/datacheck.service';
import multer from 'multer';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import { Client } from 'pg';
import sql from 'mssql';
import { Parser } from 'json2csv';

/**
 * POST /datacheck
 * Body: { data: any[] }
 * Returns a data quality report using the DataCheckService.
 */
export const datacheckRouter = Router();

const upload = multer({ storage: multer.memoryStorage() });

datacheckRouter.post('/datacheck', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = req.body?.data ?? [];
    const report = await DataCheckService.runCheck(data);
    res.json(report);
  } catch (err) {
    console.error('DataCheck error:', err);
    res.status(500).json({ error: 'DataCheck failed' });
  }
});

datacheckRouter.post('/datacheck/csv', upload.single('file'), (req: Request, res: Response): void => {
  if (!req.file) {
    res.status(400).json({ error: 'No CSV file uploaded' });
    return;
  }

  const results: any[] = [];
  const stream = Readable.from(req.file.buffer);

  stream
    .pipe(csvParser())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        const report = await DataCheckService.runCheck(results);
        res.json(report);
      } catch (err) {
        console.error('DataCheck CSV error:', err);
        res.status(500).json({ error: 'DataCheck failed for CSV' });
      }
    })
    .on('error', (err) => {
      console.error('CSV Parsing error:', err);
      res.status(500).json({ error: 'Failed to parse CSV' });
    });
});

datacheckRouter.post('/datacheck/table', async (req: Request, res: Response): Promise<void> => {
  const { serverConfig, tableName } = req.body;
  if (!serverConfig || !tableName) {
    res.status(400).json({ error: 'serverConfig and tableName are required' });
    return;
  }

  try {
    let data: any[] = [];
    if (serverConfig.type === 'postgres') {
      const client = new Client({
        host: serverConfig.host,
        port: serverConfig.port,
        user: serverConfig.user,
        password: serverConfig.password,
        database: serverConfig.database
      });
      await client.connect();
      const queryResult = await client.query(`SELECT * FROM ${tableName} LIMIT 1000`);
      data = queryResult.rows;
      await client.end();
    } else if (serverConfig.type === 'mssql') {
      const pool = await sql.connect({
        user: serverConfig.user,
        password: serverConfig.password,
        server: serverConfig.host,
        port: serverConfig.port,
        database: serverConfig.database,
        options: { encrypt: false, trustServerCertificate: true }
      });
      const queryResult = await pool.request().query(`SELECT TOP 1000 * FROM ${tableName}`);
      data = queryResult.recordset;
      await pool.close();
    } else {
      res.status(400).json({ error: 'Unsupported database type' });
      return;
    }

    const report = await DataCheckService.runCheck(data);
    res.json(report);
  } catch (err) {
    console.error('DataCheck table error:', err);
    res.status(500).json({ error: 'DataCheck failed for table scan' });
  }
});

datacheckRouter.post('/datacheck/cleanse', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = req.body?.data ?? [];
    if (!Array.isArray(data)) {
      res.status(400).json({ error: 'Data must be an array' });
      return;
    }

    const cleansedData: any[] = [];
    const seen = new Set<string>();

    for (const row of data) {
      if (!row || typeof row !== 'object') continue;

      // Drop rows with null or undefined values
      const hasNull = Object.values(row).some(v => v === null || v === undefined);
      if (hasNull) continue;

      // Drop duplicates (deep equality)
      const key = JSON.stringify(row);
      if (!seen.has(key)) {
        seen.add(key);
        cleansedData.push(row);
      }
    }

    if (cleansedData.length === 0) {
      res.status(400).json({ error: 'No data remaining after cleansing' });
      return;
    }

    const parser = new Parser();
    const csv = parser.parse(cleansedData);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="cleansed_data.csv"');
    res.send(csv);
  } catch (err) {
    console.error('Cleanse error:', err);
    res.status(500).json({ error: 'Cleansing failed' });
  }
});
