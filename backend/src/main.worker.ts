import { loadConfig } from './bootstrap/config.js';
import { buildContainer, disposeContainer } from './bootstrap/container.js';
import { MODULES } from './bootstrap/modules.js';
import { registerShutdown } from './bootstrap/shutdown.js';
import { createWorkerApp } from './bootstrap/worker-app.js';

// --queues=notify,pdf.render  -> dedicated worker pools (docs/backend/operations.md §1)
const queuesArg = process.argv.find((a) => a.startsWith('--queues='));
const queues = queuesArg ? queuesArg.slice('--queues='.length).split(',').filter(Boolean) : undefined;

const config = loadConfig();
const container = await buildContainer(config, MODULES, { role: 'worker' });
const worker = createWorkerApp(container, { queues });
await worker.start();

registerShutdown(container.cradle.logger, [() => worker.stop(), () => disposeContainer(container)], 60_000);
