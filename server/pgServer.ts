// Postgres counterpart to dbServer.ts for the Database workspace view. Mirrors
// its exported shape (readPgSchema / runPgQuery / runPgExec) so routes.ts can
// dispatch on source kind. Uses Bun's built-in Postgres client (Bun.SQL); no
// extra dependency. Connections are opened per request and closed in a finally,
// matching dbServer.ts's open-on-each-call SQLite pattern — no pool to manage.
import { SQL } from "bun";
import { assertReadOnly } from "./dbServer.ts";
import type { DbSchema, DbTable, DbColumn, QueryResult, ExecResult } from "../shared.ts";
import { DbError } from "../shared.ts";

const DEFAULT_LIMIT = 1000;
const HARD_LIMIT = 10000;

function open(url: string): SQL {
  const u = url.trim();
  if (!u) throw new DbError("not_found", "connection url is required");
  try {
    return new SQL(u);
  } catch (e) {
    throw new DbError("not_a_database", e instanceof Error ? e.message : "could not open connection");
  }
}

// Bun resolves the result of a query to an array of row objects. It also tags
// that array with metadata (.count for affected rows, .columns for the column
// order). Neither is part of the documented public type, so read them
// defensively and fall back to deriving columns from the first row's keys —
// the same fallback dbServer/routes already use for SQLite.
function columnsOf(rows: Record<string, unknown>[]): string[] {
  const meta = (rows as unknown as { columns?: { name: string }[] }).columns;
  if (Array.isArray(meta) && meta.length) return meta.map((c) => c.name);
  return rows.length ? Object.keys(rows[0]) : [];
}
function affectedOf(rows: unknown[]): number {
  const n = (rows as unknown as { count?: number }).count;
  return typeof n === "number" ? n : 0;
}

// The client's filter compiler (dbFilter.ts) emits SQLite-style `?` placeholders;
// Postgres needs `$1,$2,…`. Rewrite positionally, skipping `?` inside single- or
// double-quoted string/identifier literals so SQL-pane queries stay intact.
export function toPgPlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) {
        // A doubled quote is an escaped quote, not a terminator.
        if (sql[i + 1] === quote) { out += sql[++i]; } else { quote = null; }
      }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if (ch === "?") { out += "$" + ++n; continue; }
    out += ch;
  }
  return out;
}

export async function readPgSchema(url: string): Promise<DbSchema> {
  const db = open(url);
  try {
    // Tables + views in user schemas, with column lists in one shot.
    const cols = await db.unsafe(
      `SELECT c.table_schema, c.table_name, c.column_name, c.data_type,
              c.is_nullable, c.ordinal_position,
              t.table_type
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema NOT IN ('pg_catalog','information_schema')
          AND t.table_type IN ('BASE TABLE','VIEW')
        ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
    ) as Record<string, unknown>[];

    // Primary keys and foreign-key targets, keyed by table+column.
    const keys = await db.unsafe(
      `SELECT tc.table_schema, tc.table_name, kcu.column_name, tc.constraint_type,
              ccu.table_name  AS ref_table,
              ccu.column_name AS ref_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
         LEFT JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type IN ('PRIMARY KEY','FOREIGN KEY')
          AND tc.table_schema NOT IN ('pg_catalog','information_schema')`,
    ) as Record<string, unknown>[];

    const pk = new Set<string>();
    const fk = new Map<string, string>();
    for (const k of keys) {
      const key = `${k.table_schema}.${k.table_name}.${k.column_name}`;
      if (k.constraint_type === "PRIMARY KEY") pk.add(key);
      else if (k.constraint_type === "FOREIGN KEY" && k.ref_table)
        fk.set(key, `${k.ref_table}(${k.ref_column})`);
    }

    // Row-count estimates from the planner stats (fast; exact COUNT(*) is slow
    // on large tables). -1 where unknown, matching SQLite views.
    const counts = await db.unsafe(
      `SELECT n.nspname AS table_schema, c.relname AS table_name,
              c.reltuples::bigint AS est
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r','p')`,
    ) as Record<string, unknown>[];
    const rowCount = new Map<string, number>();
    for (const r of counts) {
      const est = Number(r.est);
      rowCount.set(`${r.table_schema}.${r.table_name}`, Number.isFinite(est) && est >= 0 ? est : -1);
    }

    // Group columns into tables, preserving information_schema order.
    const byTable = new Map<string, DbTable>();
    for (const c of cols) {
      // Qualify with schema only when not the default `public`, so the tree
      // reads cleanly for the common case while staying unambiguous otherwise.
      const schema = String(c.table_schema);
      const bare = String(c.table_name);
      const name = schema === "public" ? bare : `${schema}.${bare}`;
      let tbl = byTable.get(name);
      if (!tbl) {
        const isView = c.table_type === "VIEW";
        tbl = {
          name,
          type: isView ? "view" : "table",
          columns: [],
          rowCount: isView ? -1 : (rowCount.get(`${schema}.${bare}`) ?? -1),
          ddl: "",
        };
        byTable.set(name, tbl);
      }
      const keyId = `${schema}.${bare}.${c.column_name}`;
      const col: DbColumn = {
        name: String(c.column_name),
        type: String(c.data_type ?? ""),
        notNull: c.is_nullable === "NO",
        pk: pk.has(keyId),
        fk: fk.get(keyId) ?? null,
      };
      tbl.columns.push(col);
    }
    const tables = [...byTable.values()];
    // Synthesize a minimal CREATE statement per table for the Structure pane's
    // DDL block (Postgres has no sqlite_master.sql equivalent).
    for (const t of tables) {
      const body = t.columns
        .map((c) => `  "${c.name}" ${c.type}${c.notNull ? " NOT NULL" : ""}${c.pk ? " PRIMARY KEY" : ""}`)
        .join(",\n");
      t.ddl = `CREATE ${t.type === "view" ? "VIEW" : "TABLE"} "${t.name}" (\n${body}\n);`;
    }

    const idx = await db.unsafe(
      `SELECT indexname AS name, indexdef AS sql
         FROM pg_indexes
        WHERE schemaname NOT IN ('pg_catalog','information_schema')
        ORDER BY indexname`,
    ) as Record<string, unknown>[];
    const indexes = idx.map((r) => ({ name: String(r.name), sql: String(r.sql ?? "") }));

    const trg = await db.unsafe(
      `SELECT DISTINCT trigger_name AS name, action_statement AS sql
         FROM information_schema.triggers
        WHERE trigger_schema NOT IN ('pg_catalog','information_schema')
        ORDER BY trigger_name`,
    ) as Record<string, unknown>[];
    const triggers = trg.map((r) => ({ name: String(r.name), sql: String(r.sql ?? "") }));

    // Postgres has no pragmas; surface server metadata in the same kv shape so
    // the existing PragmasPane renders it unchanged.
    const meta = await db.unsafe(
      `SELECT version() AS version, current_database() AS database,
              current_user AS "user",
              current_setting('server_encoding') AS encoding,
              current_setting('server_version') AS server_version`,
    ) as Record<string, unknown>[];
    const m = meta[0] ?? {};
    const pragmas: Record<string, string> = {
      version: String(m.version ?? ""),
      database: String(m.database ?? ""),
      user: String(m.user ?? ""),
      encoding: String(m.encoding ?? ""),
      server_version: String(m.server_version ?? ""),
    };

    return { tables, indexes, triggers, pragmas };
  } catch (e) {
    if (e instanceof DbError) throw e;
    throw new DbError("not_a_database", e instanceof Error ? e.message : String(e));
  } finally {
    await db.close().catch(() => {});
  }
}

export async function runPgQuery(url: string, sql: string, params: unknown[], limitRaw?: number): Promise<QueryResult> {
  assertReadOnly(sql);
  const limit = Math.min(Math.max(limitRaw ?? DEFAULT_LIMIT, 1), HARD_LIMIT);
  const db = open(url);
  try {
    const t0 = performance.now();
    let rows: Record<string, unknown>[];
    try {
      rows = await db.unsafe(toPgPlaceholders(sql), params) as Record<string, unknown>[];
    } catch (e) {
      throw new DbError("sql", e instanceof Error ? e.message : String(e));
    }
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    return { columns: columnsOf(rows), rows: rows.slice(0, limit), ms };
  } finally {
    await db.close().catch(() => {});
  }
}

export async function runPgExec(url: string, sql: string): Promise<ExecResult> {
  const db = open(url);
  try {
    const t0 = performance.now();
    let rowsAffected = 0;
    try {
      const rows = await db.unsafe(sql) as unknown[];
      rowsAffected = affectedOf(rows);
    } catch (e) {
      throw new DbError("sql", e instanceof Error ? e.message : String(e));
    }
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    return { rowsAffected, ms };
  } finally {
    await db.close().catch(() => {});
  }
}
