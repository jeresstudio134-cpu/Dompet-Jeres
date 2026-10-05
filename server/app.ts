import express from 'express';
import { adminContext } from './auth.js';
import { ensureSchema } from './ensureSchema.js';
import { errorHandler } from './http.js';
import transactionsRouter from './routes/transactions.js';
import debtsHandler from '../api/debts.js';
import aiParseDebtHandler from '../api/ai-parse-debt.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '6mb' })); // foto struk dikirim sebagai base64

  app.get('/api/warmup', (_req, res) => {
    res.json({ status: 'warm', timestamp: new Date().toISOString() });
  });

  // Tanpa CORS: aplikasi dan API berada di domain yang sama
  app.use('/api', async (_req, _res, next) => {
    const url = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
    if (!url) return next();
    try {
      await ensureSchema();
      next();
    } catch (err) {
      console.warn('ensureSchema warning:', err);
      next();
    }
  });

  app.use('/api', adminContext);

  app.use('/api/transactions', transactionsRouter);
  app.all('/api/debts', (req, res) => debtsHandler(req, res));
  app.all('/api/ai-parse-debt', (req, res) => aiParseDebtHandler(req, res));
  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint tidak ditemukan.' });
  });

  app.use(errorHandler);
  return app;
}