/**
 * Generates the Drizzle table definitions from a migrated database (SQL migrations in ../db are the source of truth).
 *
 *   DATABASE_OWNER_URL=postgres://sms_owner@localhost:5432/school_platform_dev npm run db:schema
 *
 * Output: src/shared/infrastructure/db/schema/<schema>.ts (one file per module schema) + index.ts.
 * Why not `drizzle-kit pull`: it skips partitioned tables, emits `unknown()` for domains (core.paisa, citext, bytea)
 * and writes one huge file. This generator also turns single-column `CHECK (col IN (...))` constraints into
 * TypeScript literal unions, so status fields are type-checked.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const SCHEMAS = [
  'core',
  'iam',
  'audit',
  'wf',
  'sys',
  'search',
  'sis',
  'adm',
  'aca',
  'att',
  'lrn',
  'exm',
  'fee',
  'acc',
  'hrm',
  'com',
  'prt',
  'doc',
  'web',
  'bi',
  'trn',
  'hst',
  'lib',
  'inv',
  'hlt',
  'cca',
  'sec',
];
const OUT = join(import.meta.dirname, '..', 'src', 'shared', 'infrastructure', 'db', 'schema');

interface Col {
  schema: string;
  table: string;
  name: string;
  num: number;
  type: string;
  notnull: boolean;
  dflt: string | null;
  identity: string;
  generated: string;
  genexpr: string | null;
  comment: string | null;
}
interface Tbl {
  schema: string;
  table: string;
  comment: string | null;
  pk: string[];
}

const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const pascal = (s: string) => camel(s).replace(/^./, (c) => c.toUpperCase());
const tpl = (s: string) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const doc = (s: string | null, indent = '') => (s ? `${indent}/** ${s.replace(/\*\//g, '* /')} */\n` : '');

function builder(c: Col, union: string[] | undefined): { expr: string; imports: string[] } {
  let t = c.type;
  const isArray = t.endsWith('[]');
  if (isArray) t = t.slice(0, -2);
  const n = `'${c.name}'`;
  let expr: string;
  const imports: string[] = [];
  const num = /^numeric\((\d+),(\d+)\)$/.exec(t);
  const chr = /^character\((\d+)\)$/.exec(t);
  if (t === 'uuid') {
    expr = `uuid(${n})`;
    imports.push('uuid');
  } else if (t === 'text' || t === 'core.phone_e164') {
    expr = `text(${n})`;
    imports.push('text');
  } else if (t === 'core.locale') {
    expr = `text(${n}).$type<'en' | 'bn'>()`;
    imports.push('text');
  } else if (t === 'citext') {
    expr = `citext(${n})`;
  } else if (t === 'bytea') {
    expr = `bytea(${n})`;
  } else if (t === 'boolean') {
    expr = `boolean(${n})`;
    imports.push('boolean');
  } else if (t === 'smallint') {
    expr = `smallint(${n})`;
    imports.push('smallint');
  } else if (t === 'integer') {
    expr = `integer(${n})`;
    imports.push('integer');
  } else if (t === 'bigint' || t === 'core.paisa' || t === 'core.paisa_nn') {
    expr = `bigint(${n}, { mode: 'number' })`;
    imports.push('bigint');
  } else if (t === 'core.percent') {
    expr = `numeric(${n}, { precision: 5, scale: 2 })`;
    imports.push('numeric');
  } else if (num) {
    expr = `numeric(${n}, { precision: ${num[1]}, scale: ${num[2]} })`;
    imports.push('numeric');
  } else if (chr) {
    expr = `char(${n}, { length: ${chr[1]} })`;
    imports.push('char');
  } else if (t === 'timestamp with time zone') {
    expr = `timestamp(${n}, { withTimezone: true, mode: 'date' })`;
    imports.push('timestamp');
  } else if (t === 'date') {
    expr = `date(${n}, { mode: 'string' })`;
    imports.push('date');
  } else if (t === 'time without time zone') {
    expr = `time(${n})`;
    imports.push('time');
  } else if (t === 'interval') {
    expr = `interval(${n})`;
    imports.push('interval');
  } else if (t === 'inet') {
    expr = `inet(${n})`;
    imports.push('inet');
  } else if (t === 'jsonb') {
    expr = `jsonb(${n}).$type<unknown>()`;
    imports.push('jsonb');
  } else throw new Error(`unmapped type ${c.type} on ${c.schema}.${c.table}.${c.name}`);

  if (union && union.length && !isArray && t === 'text') {
    expr = expr.replace(/\)$/, `).$type<${union.map((u) => `'${u}'`).join(' | ')}>()`);
  }
  if (isArray) expr += '.array()';
  if (c.identity === 'a') expr += '.generatedAlwaysAsIdentity()';
  else if (c.identity === 'd') expr += '.generatedByDefaultAsIdentity()';
  else if (c.generated === 's' && c.genexpr) expr += `.generatedAlwaysAs(sql\`${tpl(c.genexpr)}\`)`;
  else if (c.dflt !== null) {
    expr += `.default(sql\`${tpl(c.dflt)}\`)`;
    imports.push('#sql');
  }
  if (c.generated === 's') imports.push('#sql');
  if (c.notnull && c.identity === '' && c.generated !== 's') expr += '.notNull()';
  return { expr, imports };
}

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is required');
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const tables = (
    await client.query<Tbl>(
      `
    SELECT n.nspname AS schema, c.relname AS table, obj_description(c.oid, 'pg_class') AS comment,
           coalesce((SELECT array_agg(a.attname::text ORDER BY k.ord)
                       FROM pg_constraint p, unnest(p.conkey) WITH ORDINALITY k(attnum, ord)
                       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
                      WHERE p.conrelid = c.oid AND p.contype = 'p'), '{}'::text[]) AS pk
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY($1) AND c.relkind IN ('r','p') AND NOT c.relispartition AND c.relname <> 'std_cols'
     ORDER BY 1, 2`,
      [SCHEMAS],
    )
  ).rows;

  const cols = (
    await client.query<Col>(
      `
    SELECT n.nspname AS schema, c.relname AS table, a.attname AS name, a.attnum AS num,
           CASE WHEN t.typtype = 'd' THEN tn.nspname || '.' || t.typname ELSE format_type(a.atttypid, a.atttypmod) END AS type,
           a.attnotnull AS notnull,
           CASE WHEN a.attgenerated = '' THEN pg_get_expr(d.adbin, d.adrelid) END AS dflt,
           a.attidentity::text AS identity, a.attgenerated::text AS generated,
           CASE WHEN a.attgenerated <> '' THEN pg_get_expr(d.adbin, d.adrelid) END AS genexpr,
           col_description(c.oid, a.attnum) AS comment
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid JOIN pg_namespace tn ON tn.oid = t.typnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = ANY($1) AND c.relkind IN ('r','p') AND NOT c.relispartition
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY 1, 2, a.attnum`,
      [SCHEMAS],
    )
  ).rows;

  // single-column CHECK (col = ANY (ARRAY['a'::text, ...])) -> literal union
  const checks = (
    await client.query<{ schema: string; table: string; def: string }>(
      `
    SELECT n.nspname AS schema, c.relname AS table, pg_get_constraintdef(k.oid) AS def
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY($1) AND k.contype = 'c' AND NOT c.relispartition AND array_length(k.conkey, 1) = 1`,
      [SCHEMAS],
    )
  ).rows;
  const unions = new Map<string, string[]>();
  for (const ch of checks) {
    const m = /^CHECK \(\((\w+) = ANY \(ARRAY\[(.+)\]\)\)\)$/.exec(ch.def);
    if (!m) continue;
    const values = [...m[2]!.matchAll(/'((?:[^']|'')*)'::text/g)].map((v) => v[1]!.replace(/''/g, "'"));
    unions.set(`${ch.schema}.${ch.table}.${m[1]}`, values);
  }
  await client.end();

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const header =
    '// GENERATED by scripts/gen-db-schema.ts from the live database. Do not edit; run `npm run db:schema`.\n';

  writeFileSync(
    join(OUT, '_types.ts'),
    `${header}import { customType } from 'drizzle-orm/pg-core';

/** citext: case-insensitive text (e-mail, usernames). */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/** bytea: ciphertext and hashes (AES-GCM fields, blind indexes, token hashes). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => value,
  fromDriver: (value) => value,
});
`,
  );

  const index: string[] = [header];
  for (const schema of SCHEMAS) {
    const ts = tables.filter((t) => t.schema === schema);
    if (!ts.length) continue;
    const used = new Set<string>(['pgSchema']);
    let needSql = false,
      needPk = false;
    const needCustom = new Set<string>();
    const body: string[] = [];
    for (const t of ts) {
      const tc = cols.filter((c) => c.schema === schema && c.table === t.table);
      const lines: string[] = [];
      for (const c of tc) {
        const { expr, imports } = builder(c, unions.get(`${schema}.${t.table}.${c.name}`));
        imports.forEach((i) => (i === '#sql' ? (needSql = true) : used.add(i)));
        if (expr.startsWith('citext(')) needCustom.add('citext');
        if (expr.startsWith('bytea(')) needCustom.add('bytea');
        const pk = t.pk.length === 1 && t.pk[0] === c.name ? '.primaryKey()' : '';
        lines.push(`${doc(c.comment, '  ')}  ${camel(c.name)}: ${expr}${pk},`);
      }
      const v = camel(t.table);
      const extra =
        t.pk.length > 1 ? `, (t) => [primaryKey({ columns: [${t.pk.map((p) => `t.${camel(p)}`).join(', ')}] })]` : '';
      if (extra) needPk = true;
      body.push(`${doc(t.comment)}export const ${v} = ${schema}Schema.table('${t.table}', {\n${lines.join('\n')}\n}${extra});
export type ${pascal(t.table)}Row = typeof ${v}.$inferSelect;
export type New${pascal(t.table)}Row = typeof ${v}.$inferInsert;
`);
    }
    if (needPk) used.add('primaryKey');
    const imports = [
      `import { ${[...used].sort().join(', ')} } from 'drizzle-orm/pg-core';`,
      needSql ? `import { sql } from 'drizzle-orm';` : '',
      needCustom.size ? `import { ${[...needCustom].sort().join(', ')} } from './_types.js';` : '',
    ]
      .filter(Boolean)
      .join('\n');
    writeFileSync(
      join(OUT, `${schema}.ts`),
      `${header}${imports}\n\nexport const ${schema}Schema = pgSchema('${schema}');\n\n${body.join('\n')}`,
    );
    index.push(`export * as ${schema} from './${schema}.js';`);
  }
  writeFileSync(join(OUT, 'index.ts'), index.join('\n') + '\n');
  console.log(`generated ${tables.length} tables, ${cols.length} columns, ${unions.size} typed status columns`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
