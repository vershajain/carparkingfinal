import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { fail } from '../utils/apiResponse.js';

export function notFoundHandler(req: Request, res: Response) {
  fail(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return fail(res, 400, 'Validation failed', err.flatten().fieldErrors);
  }
  if (err instanceof AppError) return fail(res, err.status, err.message, err.details);
  const e = err as { code?: number; name?: string; message?: string };
  if (e?.code === 11000) return fail(res, 409, 'Duplicate value violates a unique constraint');
  if (e?.name === 'ValidationError') return fail(res, 400, e.message ?? 'Validation failed');
  console.error('[error]', err);
  return fail(res, 500, 'Internal server error');
}
