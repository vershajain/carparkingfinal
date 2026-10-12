import { NextFunction, Request, Response } from 'express';
import { ZodTypeAny } from 'zod';

/** Validate and replace req.body with the parsed Zod result (throws ZodError -> 400). */
export const validateBody =
  (schema: ZodTypeAny) => (req: Request, _res: Response, next: NextFunction) => {
    req.body = schema.parse(req.body);
    next();
  };
