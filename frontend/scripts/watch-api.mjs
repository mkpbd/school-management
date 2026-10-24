/**
 * Keeps the frontend API types in step with the backend contract while you work.
 *   npm run api:watch     (run next to `npm run dev`; needs the backend .env and database, like api:sync)
 *
 * Watches the files that define the HTTP contract (controllers + zod schemas in modules/<m>/presentation,
 * shared/http, bootstrap/http-app.ts) and re-runs `npm run api:sync` on change, which rewrites
 * ../backend/openapi.json and src/lib/api/schema.d.ts. `npm run typecheck` then shows every service or
 * page that no longer matches the backend.
 */
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";

const backendSrc = fileURLToPath(new URL("../../backend/src", import.meta.url));
const frontendDir = fileURLToPath(new URL("..", import.meta.url));

const CONTRACT = [/^modules[\\/][^\\/]+[\\/]presentation[\\/]/, /^shared[\\/]http[\\/]/, /^bootstrap[\\/]http-app\.ts$/];
const isContract = (file) => file.endsWith(".ts") && CONTRACT.some((re) => re.test(file));

let timer = null;
let running = false;
let pending = false;
let lastChange = "";

function sync() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  const started = Date.now();
  console.log(`[api:watch] ${lastChange || "startup"} -> api:sync`);
  const child = spawn("npm", ["run", "--silent", "api:sync"], { cwd: frontendDir, stdio: "inherit", shell: true });
  child.on("exit", (code) => {
    running = false;
    console.log(
      code === 0
        ? `[api:watch] schema.d.ts updated (${Date.now() - started} ms). Run \`npm run typecheck\` to find UI code to update.`
        : `[api:watch] api:sync failed (exit ${code}); is the backend .env / database up? Waiting for the next change.`,
    );
    if (pending) {
      pending = false;
      sync();
    }
  });
}

watch(backendSrc, { recursive: true }, (_event, file) => {
  if (!file || !isContract(file)) return;
  lastChange = file;
  clearTimeout(timer);
  timer = setTimeout(sync, 800);
});

console.log(`[api:watch] watching ${backendSrc} for API contract changes`);
sync();
