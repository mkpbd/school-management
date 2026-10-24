import { loadConfig } from './bootstrap/config.js';
import { buildContainer, disposeContainer } from './bootstrap/container.js';
import { createHttpApp } from './bootstrap/http-app.js';
import { MODULES } from './bootstrap/modules.js';
import { registerShutdown } from './bootstrap/shutdown.js';

const config = loadConfig();
const container = await buildContainer(config, MODULES, { role: 'api' });
const { app } = createHttpApp(container, MODULES);
const { logger } = container.cradle;

const server = app.listen(config.PORT, () => logger.info({ port: config.PORT, env: config.NODE_ENV }, 'api listening'));
server.keepAliveTimeout = 65_000; // > typical load-balancer idle timeout
server.headersTimeout = 66_000;

registerShutdown(
  logger,
  [() => new Promise<void>((resolve) => server.close(() => resolve())), () => disposeContainer(container)],
  25_000,
);
