import express from 'express';
import { adminContext } from './auth.js';
import { ensureSchema } from './ensureSchema.js';
import { errorHandler } from './http.js';
import transactionsRouter from './routes/transactions.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '6mb' })); // foto struk dikirim sebagai base64

  // Tanpa CORS: aplikasi dan API berada di domain yang sama
  app.use('/api', async (_req, _res, next) => {
    try {
      await ensureSchema();
      next();
    } catch (err) {
      next(err);
    }
  });
  app.use('/api', adminContext);

  app.use('/api/transactions', transactionsRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint tidak ditemukan.' });
  });

  app.use(errorHandler);
  return app;
}