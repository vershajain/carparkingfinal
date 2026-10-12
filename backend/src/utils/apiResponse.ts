import { Response } from 'express';

export const ok = <T>(res: Response, data: T, message = 'OK', status = 200) =>
  res.status(status).json({ success: true, message, data });

export const fail = (res: Response, status: number, message: string, details?: unknown) =>
  res.status(status).json({ success: false, message, details });
