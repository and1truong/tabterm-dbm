// HTTP JSON shapes shared by the dbm module's server endpoints and client.

export interface DbFile {
  path: string;        // absolute
  name: string;        // basename
  sizeBytes: number;
}

export type DbObjectType = "table" | "view";

export interface DbColumn {
  name: string;
  type: string;        // declared type, "" if none
  notNull: boolean;
  pk: boolean;
  fk: string | null;   // "refsTable(refsCol)" or null
}

export interface DbTable {
  name: string;
  type: DbObjectType;
  columns: DbColumn[];
  rowCount: number;    // -1 if unknown
  ddl: string;         // sqlite_master.sql
}

export interface DbSchema {
  tables: DbTable[];          // tables + views, sqlite_master order
  indexes: { name: string; sql: string }[];
  triggers: { name: string; sql: string }[];
  pragmas: Record<string, string>; // journal_mode, foreign_keys, encoding, user_version, synchronous
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  ms: number;
}

export interface ExecResult {
  rowsAffected: number;
  ms: number;
}

// A remembered Postgres connection. Stored in tabterm's own SQLite DB so the
// picker can re-list it. `url` may contain a plaintext password.
export interface PgConnection {
  id: string;
  label: string;
  url: string;
  createdAt: number;
  lastUsedAt: number | null;
}

// Thrown by dbServer on bad path / non-read query / SQL error. HTTP layer maps
// it to a 4xx with { error }.
export class DbError extends Error {
  constructor(public code: "not_found" | "not_a_database" | "not_read_only" | "multi_statement" | "sql", message: string) {
    super(message);
    this.name = "DbError";
  }
}
