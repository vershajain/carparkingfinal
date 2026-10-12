import http from 'http';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { setIo, publish } from './utils/socket.js';
import { runScheduler } from './services/allocationService.js';
import { ensureConfig } from './services/configService.js';

async function main() {
  await connectDb();
  await ensureConfig();
  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: env.CLIENT_ORIGIN } });
  setIo(io);
  io.on('connection', (s) => console.log(`[socket] client connected ${s.id}`));
  // Aging tick: re-evaluates the queue periodically so waiting-time/aging changes take effect
  // even when no request arrives or leaves. Also pushes fresh scores to clients.
  setInterval(() => {
    runScheduler('tick').then(() => publish('queue:updated', { trigger: 'tick' })).catch((e) => console.error('[tick]', e));
  }, 30_000);
  server.listen(env.PORT, () => console.log(`[server] http://localhost:${env.PORT}`));
}

main().catch((e) => {
  console.error('Fatal startup error:', e);
  process.exit(1);
});
