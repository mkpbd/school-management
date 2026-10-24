"""Generate the data dictionary from a LIVE database (so docs can never drift from the schema).

Output: docs/database/schemas/<schema>.md  (ER diagram + every table: columns, keys, checks, indexes, triggers, RLS)
        docs/database/schemas/README.md    (index with counts)
Usage:  PGHOST=... PGPORT=... PGUSER=sms_owner PGDATABASE=... python db/tools/gen_docs.py
"""
import json
import os
import pathlib
import subprocess
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "database" / "schemas"
SCHEMAS = ["core", "iam", "audit", "wf", "sys", "search", "sis", "adm", "aca", "att", "lrn", "exm", "fee", "acc",
           "hrm", "com", "prt", "doc", "web", "bi", "trn", "lib", "inv", "hlt", "cca", "sec"]
CONVENTION_TARGETS = {"core.organisation", "core.campus", "sys.stored_file", "wf.approval_request"}


def q(sql: str):
    env = dict(os.environ, PGCLIENTENCODING="UTF8")
    res = subprocess.run(["psql", "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql],
                         capture_output=True, env=env, check=True)
    text = res.stdout.decode("utf-8").strip()
    return json.loads(text) if text else []


SCHEMA_LIST = "ARRAY[" + ",".join(f"'{s}'" for s in SCHEMAS) + "]"

TABLES = q(f"""
SELECT coalesce(json_agg(t ORDER BY t.schema, t.name), '[]') FROM (
  SELECT c.oid, n.nspname AS schema, c.relname AS name, obj_description(c.oid, 'pg_class') AS comment,
         c.relkind = 'p' AS partitioned, pg_get_partkeydef(c.oid) AS partkey,
         (SELECT count(*) FROM pg_inherits i WHERE i.inhparent = c.oid) AS partitions,
         c.relrowsecurity AS rls,
         (SELECT string_agg(polname || ': ' || pg_get_expr(polqual, polrelid), '; ') FROM pg_policy WHERE polrelid = c.oid) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ANY({SCHEMA_LIST}) AND c.relkind IN ('r','p') AND NOT c.relispartition
     AND c.relname NOT IN ('std_cols')) t""")

COLUMNS = q(f"""
SELECT coalesce(json_agg(x ORDER BY x.oid, x.num), '[]') FROM (
  SELECT a.attrelid AS oid, a.attnum AS num, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
         a.attnotnull AS notnull, pg_get_expr(d.adbin, d.adrelid) AS dflt, a.attgenerated <> '' AS generated,
         col_description(a.attrelid, a.attnum) AS comment,
         (SELECT collname FROM pg_collation WHERE oid = a.attcollation AND collname NOT IN ('default','C')) AS collation
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE n.nspname = ANY({SCHEMA_LIST}) AND c.relkind IN ('r','p') AND NOT c.relispartition
     AND a.attnum > 0 AND NOT a.attisdropped) x""")

CONSTRAINTS = q(f"""
SELECT coalesce(json_agg(x ORDER BY x.oid, x.type, x.name), '[]') FROM (
  SELECT k.conrelid AS oid, k.conname AS name, k.contype AS type, pg_get_constraintdef(k.oid) AS def,
         CASE WHEN k.contype = 'f' THEN rn.nspname || '.' || rc.relname END AS ref,
         CASE WHEN k.contype = 'f' THEN (SELECT string_agg(attname, ',') FROM pg_attribute
                                         WHERE attrelid = k.conrelid AND attnum = ANY (k.conkey)) END AS cols
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_class rc ON rc.oid = k.confrelid LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace
   WHERE n.nspname = ANY({SCHEMA_LIST}) AND NOT c.relispartition AND k.conparentid = 0
     AND k.contype IN ('p','u','f','c','x')) x""")

INDEXES = q(f"""
SELECT coalesce(json_agg(x ORDER BY x.oid, x.name), '[]') FROM (
  SELECT i.indrelid AS oid, ic.relname AS name, pg_get_indexdef(i.indexrelid) AS def
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ANY({SCHEMA_LIST}) AND NOT c.relispartition
     AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid AND k.contype IN ('p','u','x'))) x""")

TRIGGERS = q(f"""
SELECT coalesce(json_agg(x ORDER BY x.oid, x.name), '[]') FROM (
  SELECT t.tgrelid AS oid, t.tgname AS name, p.proname AS func,
         CASE WHEN t.tgtype & 2 = 2 THEN 'BEFORE' ELSE 'AFTER' END ||
         CASE WHEN t.tgtype & 4  = 4  THEN ' INSERT' ELSE '' END ||
         CASE WHEN t.tgtype & 16 = 16 THEN ' UPDATE' ELSE '' END ||
         CASE WHEN t.tgtype & 8  = 8  THEN ' DELETE' ELSE '' END AS events,
         t.tgconstraint <> 0 AS deferred
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = ANY({SCHEMA_LIST}) AND NOT c.relispartition AND NOT t.tgisinternal AND t.tgparentid = 0) x""")

SCHEMA_COMMENTS = {r["s"]: r["c"] for r in q(f"""
SELECT coalesce(json_agg(json_build_object('s', nspname, 'c', obj_description(oid, 'pg_namespace'))), '[]')
  FROM pg_namespace WHERE nspname = ANY({SCHEMA_LIST})""")}

cols_by, cons_by, idx_by, trg_by = (defaultdict(list) for _ in range(4))
for c in COLUMNS:
    cols_by[c["oid"]].append(c)
for k in CONSTRAINTS:
    cons_by[k["oid"]].append(k)
for i in INDEXES:
    idx_by[i["oid"]].append(i)
for t in TRIGGERS:
    trg_by[t["oid"]].append(t)


def md(s) -> str:
    return "" if s is None else str(s).replace("|", "\\|").replace("\n", " ")


def ent(full: str) -> str:
    return full.replace(".", "__")


def render_schema(schema: str, tables: list) -> str:
    lines = [f"# Schema `{schema}`", "", f"> {SCHEMA_COMMENTS.get(schema) or ''}", "",
             "Generated from the live database by `db/tools/gen_docs.py` — do not edit by hand.", "",
             f"**Tables:** {len(tables)}", ""]
    # ERD: tables of this schema, PK/FK columns only; convention FKs (org/campus/file/approval) omitted for clarity
    rels, external = [], set()
    for t in tables:
        full = f"{schema}.{t['name']}"
        for k in cons_by[t["oid"]]:
            if k["type"] == "f" and k["ref"] not in CONVENTION_TARGETS:
                if not k["ref"].startswith(schema + "."):
                    external.add(k["ref"])
                rels.append(f"  {ent(k['ref'])} ||--o{{ {ent(full)} : \"{k['cols']}\"")
    if tables:
        lines += ["## Entity-relationship diagram", "",
                  "Convention FKs to `core.organisation`, `core.campus`, `sys.stored_file` and `wf.approval_request` "
                  "are omitted from the diagram (see table details).", "", "```mermaid", "erDiagram"]
        for t in tables:
            keycols = []
            pk = {c for k in cons_by[t["oid"]] if k["type"] == "p" for c in
                  k["def"].split("(", 1)[1].rstrip(")").replace(" ", "").split(",")}
            fk = {c for k in cons_by[t["oid"]] if k["type"] == "f" and k["ref"] not in CONVENTION_TARGETS
                  for c in (k["cols"] or "").split(",")}
            for c in cols_by[t["oid"]]:
                if c["name"] in pk or c["name"] in fk:
                    typ = c["type"].split("(")[0].replace(" ", "_").replace(".", "_")
                    tag = "PK" if c["name"] in pk else "FK"
                    if c["name"] in pk and c["name"] in fk:
                        tag = "PK, FK"
                    keycols.append(f"    {typ} {c['name']} {tag}")
            lines.append(f"  {ent(schema + '.' + t['name'])} {{")
            lines += keycols or ["    text no_key_columns"]
            lines.append("  }")
        for e in sorted(external):
            lines.append(f"  {ent(e)} {{")
            lines.append("    uuid id PK")
            lines.append("  }")
        lines += sorted(set(rels))
        lines += ["```", ""]

    lines += ["## Tables", ""]
    lines += [f"- [`{schema}.{t['name']}`](#{schema}{t['name'].replace('_', '')}) — {md(t['comment'])}" for t in tables]
    lines.append("")
    for t in tables:
        lines += [f"### `{schema}.{t['name']}`", "", md(t["comment"]), ""]
        facts = []
        if t["partitioned"]:
            facts.append(f"Partitioned `{t['partkey']}` ({t['partitions']} partitions incl. default)")
        if t["rls"]:
            facts.append(f"Row-level security: `{md(t['policies'])}`")
        if facts:
            lines += ["- " + f for f in facts] + [""]
        lines += ["| Column | Type | Null | Default | Description |", "|---|---|---|---|---|"]
        for c in cols_by[t["oid"]]:
            dflt = "*generated*" if c["generated"] else md(c["dflt"])
            typ = md(c["type"]) + (f" COLLATE {c['collation']}" if c["collation"] else "")
            lines.append(f"| `{c['name']}` | {typ} | {'' if c['notnull'] else 'yes'} | {dflt} | {md(c['comment'])} |")
        lines.append("")
        cons = cons_by[t["oid"]]
        if cons:
            label = {"p": "PK", "u": "UNIQUE", "f": "FK", "c": "CHECK", "x": "EXCLUDE"}
            lines += ["| Constraint | Kind | Definition |", "|---|---|---|"]
            for k in sorted(cons, key=lambda k: "pufxc".index(k["type"])):
                lines.append(f"| `{k['name']}` | {label[k['type']]} | `{md(k['def'])}` |")
            lines.append("")
        if idx_by[t["oid"]]:
            lines += ["**Indexes**", ""] + [f"- `{md(i['def'])}`" for i in idx_by[t["oid"]]] + [""]
        if trg_by[t["oid"]]:
            lines += ["**Triggers**", ""] + [
                f"- `{g['name']}` — {g['events']} → `{g['func']}()`" + (" (deferred constraint trigger)" if g["deferred"] else "")
                for g in trg_by[t["oid"]]] + [""]
    return "\n".join(lines) + "\n"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    by_schema = defaultdict(list)
    for t in TABLES:
        by_schema[t["schema"]].append(t)
    index = ["# Data dictionary", "", "Generated from the live database by `db/tools/gen_docs.py`.", "",
             "| Schema | Purpose | Tables | Columns | FKs |", "|---|---|---|---|---|"]
    for s in SCHEMAS:
        tables = by_schema.get(s, [])
        (OUT / f"{s}.md").write_text(render_schema(s, tables), encoding="utf-8", newline="\n")
        ncols = sum(len(cols_by[t["oid"]]) for t in tables)
        nfk = sum(1 for t in tables for k in cons_by[t["oid"]] if k["type"] == "f")
        index.append(f"| [`{s}`]({s}.md) | {md(SCHEMA_COMMENTS.get(s))} | {len(tables)} | {ncols} | {nfk} |")
    total_cols = sum(len(v) for v in cols_by.values())
    index += ["", f"**Total:** {len(TABLES)} tables, {total_cols} columns, "
                  f"{sum(1 for k in CONSTRAINTS if k['type'] == 'f')} foreign keys, "
                  f"{sum(1 for k in CONSTRAINTS if k['type'] == 'c')} check constraints, "
                  f"{sum(1 for k in CONSTRAINTS if k['type'] == 'x')} exclusion constraints, "
                  f"{len(INDEXES)} secondary indexes, {len(TRIGGERS)} triggers.", ""]
    (OUT / "README.md").write_text("\n".join(index), encoding="utf-8", newline="\n")
    print(f"wrote {len(SCHEMAS)} schema docs, {len(TABLES)} tables, {total_cols} columns")


if __name__ == "__main__":
    main()
