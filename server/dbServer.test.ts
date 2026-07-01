import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  discoverDatabases,
  readSchema,
  runQuery,
  runExec,
  DbError,
} from "./dbServer.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dbserver-"));
});

function seed(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, age INTEGER);
    CREATE VIEW active_users AS SELECT id, email FROM users WHERE age >= 18;
    CREATE INDEX idx_email ON users(email);
    CREATE TRIGGER tr AFTER INSERT ON users BEGIN SELECT 1; END;
  `);
  db.query("INSERT INTO users (email, age) VALUES (?, ?)").run("a@x", 21);
  db.query("INSERT INTO users (email, age) VALUES (?, ?)").run("b@x", 9);
  db.close();
}

describe("discoverDatabases", () => {
  test("finds .db/.sqlite/.sqlite3 under cwd, skipping ignored dirs", () => {
    seed(join(dir, "app.db"));
    seed(join(dir, "sub", "cache.sqlite"));
    seed(join(dir, "node_modules", "pkg", "ignored.sqlite3")); // must be skipped
    const out = discoverDatabases(dir).map((f) => f.name).sort();
    expect(out).toEqual(["app.db", "cache.sqlite"]);
  });

  test("returns empty array for a missing cwd", () => {
    expect(discoverDatabases(join(dir, "nope"))).toEqual([]);
  });
});

describe("readSchema", () => {
  test("returns tables + views with columns, pk, fk, row count, ddl", () => {
    seed(join(dir, "app.db"));
    const s = readSchema(join(dir, "app.db"));
    const users = s.tables.find((t) => t.name === "users")!;
    expect(users.type).toBe("table");
    expect(users.rowCount).toBe(2);
    const id = users.columns.find((c) => c.name === "id")!;
    expect(id.pk).toBe(true);
    // SQLite reports notnull=0 for INTEGER PRIMARY KEY (rowid alias), so assert
    // notNull mapping against an explicitly NOT NULL column instead.
    const email = users.columns.find((c) => c.name === "email")!;
    expect(email.notNull).toBe(true);
    const view = s.tables.find((t) => t.name === "active_users")!;
    expect(view.type).toBe("view");
    expect(s.indexes.map((i) => i.name)).toContain("idx_email");
    expect(s.triggers.map((t) => t.name)).toContain("tr");
    expect(s.pragmas.journal_mode).toBeTruthy();
  });

  test("throws not_found for a missing file", () => {
    expect(() => readSchema(join(dir, "ghost.db"))).toThrow(DbError);
  });
});

describe("runQuery", () => {
  test("runs a SELECT and returns columns + object rows + ms", () => {
    seed(join(dir, "app.db"));
    const r = runQuery(join(dir, "app.db"), "SELECT id, email FROM users WHERE age >= ?", [18], 100);
    expect(r.columns).toEqual(["id", "email"]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].email).toBe("a@x");
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  test("rejects a write statement", () => {
    seed(join(dir, "app.db"));
    expect(() => runQuery(join(dir, "app.db"), "DELETE FROM users", [], 100)).toThrow(DbError);
  });

  test("rejects multiple statements", () => {
    seed(join(dir, "app.db"));
    expect(() => runQuery(join(dir, "app.db"), "SELECT 1; SELECT 2", [], 100)).toThrow(DbError);
  });
});

describe("runExec", () => {
  test("creates a view, then query can read it", () => {
    seed(join(dir, "app.db"));
    const r = runExec(join(dir, "app.db"), "CREATE VIEW adults AS SELECT id FROM users WHERE age >= 18");
    expect(r.rowsAffected).toBe(0);
    const q = runQuery(join(dir, "app.db"), "SELECT COUNT(*) AS n FROM adults", [], 100);
    expect(Number(q.rows[0].n)).toBe(1);
  });
});
