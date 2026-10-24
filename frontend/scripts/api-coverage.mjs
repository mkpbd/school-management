/**
 * Lists backend endpoints (from src/lib/api/schema.d.ts) that no frontend code references yet.
 *   npm run api:coverage            all modules
 *   npm run api:coverage -- att hrm only these modules
 *
 * Device / machine endpoints with no UI on purpose are listed in IGNORE.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../src", import.meta.url));
const schemaFile = join(src, "lib/api/schema.d.ts");

const IGNORE = new Set([
  "/api/v1/auth/refresh", // called by client.ts refresh-and-retry
  "/api/v1/trn/gps/ingest", // GPS tracker devices
  "/api/v1/trn/gps/osmand", // OsmAnd phone tracker
]);

const paths = [...new Set([...readFileSync(schemaFile, "utf8").matchAll(/^ {4}"(\/api\/v1\/[^"]+)": \{/gm)].map((m) => m[1]))];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.tsx?$/.test(name) && full !== schemaFile) yield full;
  }
}
const code = [...files(src)].map((f) => readFileSync(f, "utf8")).join("\n");

const only = process.argv.slice(2);
const missing = paths.filter((p) => {
  const mod = p.split("/")[3];
  if (IGNORE.has(p) || (only.length && !only.includes(mod))) return false;
  // template-literal URLs (EventSource, downloads): match the path up to the first {param}
  const prefix = p.split("{")[0];
  return !code.includes(`"${p}"`) && !(p.includes("{") && code.includes(`\`${prefix}`));
});

const byModule = Object.groupBy(missing, (p) => p.split("/")[3]);
for (const [mod, list] of Object.entries(byModule)) {
  console.log(`\n${mod} (${list.length})`);
  for (const p of list) console.log(`  ${p}`);
}
console.log(`\n${missing.length} of ${paths.length} endpoints have no frontend usage.`);
