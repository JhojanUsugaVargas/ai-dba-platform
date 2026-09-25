import { Router, Request, Response } from 'express';
import { DataCheckService } from '../datacheck/datacheck.service';

/**
 * POST /datacheck
 * Body: { data: any[] }
 * Returns a data quality report using the DataCheckService.
 */
export const datacheckRouter = Router();

datacheckRouter.post('/datacheck', async (req: Request, res: Response) => {
  try {
    const data = req.body?.data ?? [];
    const report = await DataCheckService.runCheck(data);
    res.json(report);
  } catch (err) {
    console.error('DataCheck error:', err);
    res.status(500).json({ error: 'DataCheck failed' });
  }
});
