// server.ts
// Peluncur untuk development lokal / AI Studio. Produksi Vercel memakai api/index.ts.
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createApp } from './server/app.js';

const app = createApp();
const PORT = Number(process.env.PORT) || 3000;

async function setupFrontend() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('⚡ Vite dev middleware aktif');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

await setupFrontend();

app.listen(PORT, () => {
  console.log(`🚀 Server Dompet Jeres aktif di port ${PORT}`);
});