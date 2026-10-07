import { createServer } from './server.js';
import { PORT } from './config.js';
const app = await createServer();
try {
  await app.listen({ port: PORT, host: '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close();
  });
