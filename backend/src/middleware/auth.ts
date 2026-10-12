import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from '../utils/errors.js';

export type Role = 'admin' | 'operator';
export interface AuthUser {
  username: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  try {
    const p = jwt.verify(header.slice(7), env.JWT_SECRET) as AuthUser;
    req.user = { username: p.username, role: p.role };
    next();
  } catch {
    next(unauthorized('Invalid or expired token'));
  }
}

/** requireRole('operator') allows operator and admin; requireRole('admin') allows admin only. */
export const requireRole = (min: Role) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized());
  if (min === 'admin' && req.user.role !== 'admin') return next(forbidden('Admin role required'));
  next();
};
