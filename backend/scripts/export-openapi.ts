/**
 * Writes openapi.json (the API contract) from the route definitions, for client generation and CI diffing.
 *   npm run openapi            (needs DATABASE_URL: the container resolves the organisation at boot)
 */
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../src/bootstrap/config.js';
import { buildContainer, disposeContainer } from '../src/bootstrap/container.js';
import { createHttpApp } from '../src/bootstrap/http-app.js';
import { MODULES } from '../src/bootstrap/modules.js';

const config = loadConfig();
const container = await buildContainer(config, MODULES, { role: 'api' });
const { openapi } = createHttpApp(container, MODULES);
writeFileSync('openapi.json', JSON.stringify(openapi.document(config.PUBLIC_BASE_URL), null, 2));
await disposeContainer(container);
console.log('openapi.json written');
