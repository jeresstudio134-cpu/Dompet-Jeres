import { createApp } from '../server/app.js';

export const config = { maxDuration: 60 }; // Gemini bisa butuh >10 detik untuk foto

// Express app adalah fungsi (req, res), jadi bisa langsung dipakai sebagai handler Vercel
export default createApp();