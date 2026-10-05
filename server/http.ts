import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof HttpError ? err.status : 500;
  const causeMsg = err?.cause?.message || '';
  if (status === 500) console.error('Server error:', err, causeMsg);
  const message = causeMsg ? `${err?.message || 'Server error'} (${causeMsg})` : err?.message || 'Server error';
  res.status(status).json({ success: false, error: message });
}