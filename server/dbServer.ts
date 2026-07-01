import { Database } from "bun:sqlite";
import { readdirSync, statSync } from "node:fs";
import { join, extname, isAbsolute, normalize } from "node:path";
import { homedir } from "node:os";
import type { DbFile, DbSchema, DbTable, DbColumn, QueryResult, ExecResult } from "../shared.ts";
import { DbError } from "../shared.ts";
export { DbError } from "../shared.ts";

// Recursive-discovery ignore set. Matched against directory base names only.
const IGNORE_DIRS = new Set([
  ".git", "node_modules", ".svn", ".hg", "dist", "build", ".next", ".cache",
  "target", "venv", ".venv", "__pycache__", ".turbo", "out", "coverage",
]);
const DB_EXTS = new Set([".db", ".sqlite", ".sqlite3"]);
const MAX_RESULTS = 200;
const MAX_DEPTH = 10;
const DEFAULT_LIMIT = 1000;
const HARD_LIMIT = 10000;

function resolvePath(raw: string): string {
  let p = raw.trim();
  if (!p || p === "~") p = homedir();
  else if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
  if (!isAbsolute(p)) throw new DbError("not_found", "path must be absolute");
  return normalize(p);
}

function openRead(path: string): Database {
  let st;
  try { st = statSync(path); } catch { throw new DbError("not_found", "database file not found"); }
  if (!st.isFile()) throw new DbError("not_found", "not a file");
  try { return new Database(path, { readonly: true }); }
  catch { throw new DbError("not_a_database", "could not open as sqlite (read-only)"); }
}
function openWrite(path: string): Database {
  let st;
  try { st = statSync(path); } catch { throw new DbError("not_found", "database file not found"); }
  if (!st.isFile()) throw new DbError("not_found", "not a file");
  try { return new Database(path); }
  catch { throw new DbError("not_a_database", "could not open as sqlite (read/write)"); }
}

// Walk cwd collecting DB files. Skips ignored dirs and recurses up to MAX_DEPTH.
export function discoverDatabases(cwdRaw: string): DbFile[] {
  let root: string;
  try { root = resolvePath(cwdRaw); } catch { return []; }
  let st;
  try { st = statSync(root); } catch { return []; }
  if (!st.isDirectory()) return [];

  const out: DbFile[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= MAX_RESULTS || depth > MAX_DEPTH) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_RESULTS) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        walk(full, depth + 1);
      } else if (e.isFile() && DB_EXTS.has(extname(e.name).toLowerCase())) {
        try {
          out.push({ path: full, name: e.name, sizeBytes: statSync(full).size });
        } catch { /* skip unreadable */ }
      }
    }
  };
  walk(root, 0);
  return out;
}

function readCols(db: Database, name: string, isView: boolean): DbColumn[] {
  const info = db.query<{ name: string; type: string; notnull: number; pk: number; dflt_value: unknown }, []>(
    `PRAGMA table_info(${quoteIdent(name)})`,
  ).all();
  // foreign keys (tables only; views have none)
  let fkMap: Record<string, string> = {};
  if (!isView) {
    for (const row of db.query<{ table: string; from: string; to: string }, []>(
      `PRAGMA foreign_key_list(${quoteIdent(name)})`,
    ).all()) {
      fkMap[row.from] = `${row.table}(${row.to})`;
    }
  }
  return info.map((c) => ({
    name: c.name,
    type: c.type ?? "",
    notNull: c.notnull === 1,
    pk: c.pk > 0,
    fk: fkMap[c.name] ?? null,
  }));
}

function rowCount(db: Database, name: string, isView: boolean): number {
  if (isView) return -1;
  try {
    const r = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${quoteIdent(name)}`).get();
    return r?.n ?? -1;
  } catch { return -1; }
}

export function readSchema(pathRaw: string): DbSchema {
  const path = resolvePath(pathRaw);
  const db = openRead(path);
  try {
    const objs = db.query<{ name: string; type: string; sql: string }, []>(
      "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name",
    ).all();
    const tables: DbTable[] = [];
    const indexes: { name: string; sql: string }[] = [];
    const triggers: { name: string; sql: string }[] = [];
    for (const o of objs) {
      if (o.type === "table" || o.type === "view") {
        const isView = o.type === "view";
        tables.push({
          name: o.name,
          type: o.type,
          columns: readCols(db, o.name, isView),
          rowCount: rowCount(db, o.name, isView),
          ddl: o.sql ?? "",
        });
      } else if (o.type === "index") indexes.push({ name: o.name, sql: o.sql ?? "" });
      else if (o.type === "trigger") triggers.push({ name: o.name, sql: o.sql ?? "" });
    }
    const pragma = (k: string) => {
      const row = db.query<Record<string, unknown>, []>(`PRAGMA ${k}`).get();
      return String((row && Object.values(row)[0]) ?? "");
    };
    const pragmas: Record<string, string> = {
      journal_mode: pragma("journal_mode"),
      foreign_keys: pragma("foreign_keys"),
      encoding: pragma("encoding"),
      user_version: pragma("user_version"),
      synchronous: pragma("synchronous"),
    };
    return { tables, indexes, triggers, pragmas };
  } finally {
    db.close();
  }
}

// A single read-only statement: first verb must be SELECT/WITH/EXPLAIN/PRAGMA-select,
// and the body must not contain a statement-separating ";" followed by more SQL.
export function assertReadOnly(sql: string): void {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (trimmed.includes(";")) throw new DbError("multi_statement", "only a single statement is allowed");
  const verb = trimmed.split(/\s/, 1)[0].toUpperCase();
  const READ = new Set(["SELECT", "WITH", "EXPLAIN", "VALUES"]);
  if (!READ.has(verb)) throw new DbError("not_read_only", `statement must start with SELECT/WITH (got "${verb}")`);
}

export function runQuery(pathRaw: string, sql: string, params: unknown[], limitRaw?: number): QueryResult {
  assertReadOnly(sql);
  const limit = Math.min(Math.max(limitRaw ?? DEFAULT_LIMIT, 1), HARD_LIMIT);
  const db = openRead(resolvePath(pathRaw));
  try {
    const t0 = performance.now();
    const stmt = db.prepare(sql);
    let columns: string[] = [];
    try {
      // bun:sqlite exposes column metadata on the prepared statement.
      const cols = (stmt as unknown as { columns?: () => { name: string }[] }).columns?.() ?? [];
      columns = cols.map((c) => c.name);
    } catch { /* fall back to row keys below */ }
    let rows: Record<string, unknown>[];
    try { rows = stmt.all(...(params as never[])) as Record<string, unknown>[]; }
    catch (e) { throw new DbError("sql", e instanceof Error ? e.message : String(e)); }
    if (!columns.length && rows.length) columns = Object.keys(rows[0]);
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    return { columns, rows: rows.slice(0, limit), ms };
  } finally {
    db.close();
  }
}

export function runExec(pathRaw: string, sql: string): ExecResult {
  const db = openWrite(resolvePath(pathRaw));
  try {
    const t0 = performance.now();
    let rowsAffected = 0;
    try {
      db.exec(sql);
      rowsAffected = db.query<{ c: number }, []>("SELECT changes() AS c").get()?.c ?? 0;
    }
    catch (e) { throw new DbError("sql", e instanceof Error ? e.message : String(e)); }
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    return { rowsAffected, ms };
  } finally {
    db.close();
  }
}

// Quote an identifier for safe interpolation into PRAGMA table_info(<ident>) etc.
function quoteIdent(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return '"' + name.replace(/"/g, '""') + '"';
}
