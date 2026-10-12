export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new AppError(400, m, d);
export const unauthorized = (m = 'Authentication required') => new AppError(401, m);
export const forbidden = (m = 'Insufficient permissions') => new AppError(403, m);
export const notFound = (m = 'Resource not found') => new AppError(404, m);
export const conflict = (m: string, d?: unknown) => new AppError(409, m, d);
