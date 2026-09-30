import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

export const loginSchema = z.object({
  body: z.object({
    username: z.string().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required')
  })
});

export const datacheckSchema = z.object({
  body: z.object({
    data: z.array(z.record(z.any())).optional().default([])
  })
});

// Middleware to validate incoming requests
export const validateRequest = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (err: any) {
      // Return a generic error message so server details aren't leaked.
      res.status(400).json({ error: 'Invalid request payload' });
    }
  };
};
