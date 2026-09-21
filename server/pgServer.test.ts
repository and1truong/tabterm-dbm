import { describe, test, expect } from "bun:test";
import { collectPgKeyMetadata, toPgPlaceholders, readPgSchema, runPgQuery, runPgExec, runPgRowChanges } from "./pgServer.ts";
import { DbError } from "../shared.ts";

describe("toPgPlaceholders", () => {
  test("numbers ? positionally", () => {
    expect(toPgPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?")).toBe(
      "SELECT * FROM t WHERE a = $1 AND b = $2",
    );
  });

  test("leaves ? inside string literals alone", () => {
    expect(toPgPlaceholders("SELECT * FROM t WHERE name = 'a?b' AND id = ?")).toBe(
      "SELECT * FROM t WHERE name = 'a?b' AND id = $1",
    );
  });

  test("leaves ? inside quoted identifiers alone", () => {
    expect(toPgPlaceholders('SELECT "we?rd" FROM t WHERE id = ?')).toBe(
      'SELECT "we?rd" FROM t WHERE id = $1',
    );
  });

  test("handles doubled-quote escapes", () => {
    expect(toPgPlaceholders("SELECT * FROM t WHERE x = 'it''s ? here' AND y = ?")).toBe(
      "SELECT * FROM t WHERE x = 'it''s ? here' AND y = $1",
    );
  });

  test("keeps backslash escapes inside PostgreSQL E-strings", () => {
    expect(toPgPlaceholders("SELECT E'it\\'s ? literal', ?::int", 1)).toBe(
      "SELECT E'it\\'s ? literal', $1::int",
    );
  });

  test("tracks nested PostgreSQL block comments", () => {
    expect(toPgPlaceholders("SELECT /* outer /* inner */ ? still outer */ ?::int", 1)).toBe(
      "SELECT /* outer /* inner */ ? still outer */ $1::int",
    );
  });

  test("no placeholders is a no-op", () => {
    expect(toPgPlaceholders("SELECT 1")).toBe("SELECT 1");
  });

  test("preserves PostgreSQL JSON operators and dollar-quoted content", () => {
    expect(toPgPlaceholders("SELECT payload ? 'key', payload ?| array['a'], payload ?& array['b'] FROM events", 0)).toBe(
      "SELECT payload ? 'key', payload ?| array['a'], payload ?& array['b'] FROM events",
    );
    expect(toPgPlaceholders("SELECT $$ ? $$, $body$ ?| ?& $body$, ?::int", 1)).toBe(
      "SELECT $$ ? $$, $body$ ?| ?& $body$, $1::int",
    );
    expect(toPgPlaceholders("SELECT * FROM events WHERE payload ? 'key' AND id = ?", 1)).toBe(
      "SELECT * FROM events WHERE payload ? 'key' AND id = $1",
    );
    expect(toPgPlaceholders("SELECT * FROM events WHERE id = ? AND payload ? 'key'", 1)).toBe(
      "SELECT * FROM events WHERE id = $1 AND payload ? 'key'",
    );
    expect(toPgPlaceholders("SELECT payload @? '$.key', id = ? FROM events", 1)).toBe(
      "SELECT payload @? '$.key', id = $1 FROM events",
    );
  });
});

test("pairs composite foreign-key columns by catalog ordinal", () => {
  const metadata = collectPgKeyMetadata([
    { table_schema: "audit", table_name: "events", constraint_name: "events_tenant_actor_fkey", constraint_type: "FOREIGN KEY", column_name: "tenant_id", ref_schema: "core", ref_table: "users", ref_column: "tenant_id" },
    { table_schema: "audit", table_name: "events", constraint_name: "events_tenant_actor_fkey", constraint_type: "FOREIGN KEY", column_name: "actor_id", ref_schema: "core", ref_table: "users", ref_column: "id" },
  ]);
  expect(metadata.foreign.get("audit.events.tenant_id")).toBe("core.users(tenant_id)");
  expect(metadata.foreign.get("audit.events.actor_id")).toBe("core.users(id)");
});

test("groups standalone unique-index columns by index name", () => {
  // Row shape emitted by the pg_index query for a CREATE UNIQUE INDEX outside
  // any constraint — constraint_name carries the index name, refs are null.
  const metadata = collectPgKeyMetadata([
    { table_schema: "public", table_name: "accounts", constraint_name: "accounts_email_idx", constraint_type: "UNIQUE", column_name: "email", ref_schema: null, ref_table: null, ref_column: null },
    { table_schema: "public", table_name: "accounts", constraint_name: "accounts_tenant_slug_idx", constraint_type: "UNIQUE", column_name: "tenant_id", ref_schema: null, ref_table: null, ref_column: null },
    { table_schema: "public", table_name: "accounts", constraint_name: "accounts_tenant_slug_idx", constraint_type: "UNIQUE", column_name: "slug", ref_schema: null, ref_table: null, ref_column: null },
  ]);
  expect(metadata.uniqueGroups.get("public.accounts.accounts_email_idx")).toEqual(["email"]);
  expect(metadata.uniqueGroups.get("public.accounts.accounts_tenant_slug_idx")).toEqual(["tenant_id", "slug"]);
});

// Integration tests require a live Postgres. Set TEST_PG_URL to enable, e.g.
//   TEST_PG_URL=postgres://postgres:pw@localhost:5432/postgres bun test pgServer
const PG = process.env.TEST_PG_URL;
const pgDescribe = PG ? describe : describe.skip;

pgDescribe("pgServer (live)", () => {
  const url = PG!;
  const T = "pgserver_test_t";

  test("exec rejects nothing / read+schema round-trip", async () => {
    await runPgExec(url, `DROP TABLE IF EXISTS ${T}`);
    await runPgExec(url, `DROP TYPE IF EXISTS ${T}_mood`);
    await runPgExec(url, `CREATE TYPE ${T}_mood AS ENUM ('active', 'paused')`);
    await runPgExec(url, `CREATE TABLE ${T} (
      id serial PRIMARY KEY, email text NOT NULL, age int, document xml,
      mood ${T}_mood, tags text[], labels varchar[], active_period int4range, raw_documents xml[]
    )`);
    const ins = await runPgExec(url, `INSERT INTO ${T} (email, age) VALUES ('a@x', 21), ('b@x', 9)`);
    expect(ins.rowsAffected).toBe(2);

    const schema = await readPgSchema(url);
    const tbl = schema.tables.find((t) => t.name === T);
    expect(tbl).toBeTruthy();
    expect(tbl!.schema).toBe("public");
    expect(tbl!.columns.map((c) => c.name)).toEqual(["id", "email", "age", "document", "mood", "tags", "labels", "active_period", "raw_documents"]);
    expect(tbl!.columns.find((c) => c.name === "id")!.pk).toBe(true);
    expect(tbl!.columns.find((c) => c.name === "email")!.notNull).toBe(true);
    expect(tbl!.columns.find((c) => c.name === "email")!.comparable).toBe(true);
    expect(tbl!.columns.find((c) => c.name === "document")!.comparable).toBe(false);
    expect(tbl!.columns.find((c) => c.name === "mood")!.comparable).toBe(true);
    expect(tbl!.columns.find((c) => c.name === "tags")!.comparable).toBe(true);
    expect(tbl!.columns.find((c) => c.name === "labels")!.comparable).toBe(true);
    expect(tbl!.columns.find((c) => c.name === "active_period")!.comparable).toBe(true);
    expect(tbl!.columns.find((c) => c.name === "raw_documents")!.comparable).toBe(false);
    expect(schema.pragmas.database).toBeTruthy();

    await runPgExec(url, `DROP TABLE ${T}`);
    await runPgExec(url, `DROP TYPE ${T}_mood`);
  });

  test("query rewrites ? params and returns rows", async () => {
    await runPgExec(url, `DROP TABLE IF EXISTS ${T}`);
    await runPgExec(url, `CREATE TABLE ${T} (id int, email text)`);
    await runPgExec(url, `INSERT INTO ${T} VALUES (1, 'a@x'), (2, 'b@x')`);

    const r = await runPgQuery(url, `SELECT email FROM ${T} WHERE id = ?`, [2], 100);
    expect(r.columns).toEqual(["email"]);
    expect(r.rows).toEqual([{ email: "b@x" }]);

    await runPgExec(url, `DROP TABLE ${T}`);
  });

  test("query refuses write statements", async () => {
    await expect(runPgQuery(url, `DELETE FROM ${T}`, [], 100)).rejects.toBeInstanceOf(DbError);
  });

  test("bad connection surfaces a DbError", async () => {
    await expect(readPgSchema("postgres://nobody:nobody@127.0.0.1:1/none")).rejects.toBeInstanceOf(DbError);
  });

  test("standalone unique index surfaces as a row identity", async () => {
    await runPgExec(url, `DROP TABLE IF EXISTS ${T}_uidx`);
    await runPgExec(url, `CREATE TABLE ${T}_uidx (slug text NOT NULL, note text)`);
    await runPgExec(url, `CREATE UNIQUE INDEX ${T}_uidx_slug ON ${T}_uidx (slug)`);
    // Constraint-backed, partial, and expression indexes must not qualify. The
    // expression case is a MIXED index — a pure `(lower(slug))` index emits no
    // rows regardless, so only a mixed one actually exercises the indexprs
    // filter (it would otherwise advertise ["note"] as unique).
    await runPgExec(url, `CREATE UNIQUE INDEX ${T}_uidx_partial ON ${T}_uidx (note) WHERE note IS NOT NULL`);
    await runPgExec(url, `CREATE UNIQUE INDEX ${T}_uidx_expr ON ${T}_uidx (note, (lower(slug)))`);

    const schema = await readPgSchema(url);
    const tbl = schema.tables.find((t) => t.name === `${T}_uidx`);
    expect(tbl!.uniqueKeys).toContainEqual(["slug"]);
    expect(tbl!.uniqueKeys).not.toContainEqual(["note"]);
    expect(tbl!.uniqueKeys).not.toContainEqual(["lower"]);

    await runPgExec(url, `DROP TABLE ${T}_uidx`);
  });

  test("runPgRowChanges applies a batch and rolls back on conflict", async () => {
    await runPgExec(url, `DROP TABLE IF EXISTS ${T}_mut`);
    await runPgExec(url, `CREATE TABLE ${T}_mut (slug text PRIMARY KEY, note text)`);
    const table = { name: `${T}_mut` };

    const inserted = await runPgRowChanges(url, [
      { kind: "insert", table, values: { slug: "a", note: "one" } },
      { kind: "insert", table, values: { slug: "b", note: null } },
    ]);
    expect(inserted).toMatchObject({ applied: 2, rowsAffected: 2 });

    const updated = await runPgRowChanges(url, [
      { kind: "update", table, key: { slug: "a" }, expected: { slug: "a", note: "one" }, values: { note: "two" } },
    ]);
    expect(updated.rowsAffected).toBe(1);

    // A stale `expected` must conflict and roll the whole batch back — the
    // delete of a healthy row behind it must not land.
    await expect(runPgRowChanges(url, [
      { kind: "update", table, key: { slug: "a" }, expected: { slug: "a", note: "stale" }, values: { note: "x" } },
      { kind: "delete", table, key: { slug: "b" }, expected: { slug: "b", note: null } },
    ])).rejects.toMatchObject({ code: "conflict" });
    const alive = await runPgQuery(url, `SELECT slug, note FROM ${T}_mut ORDER BY slug`, [], 100);
    expect(alive.rows).toEqual([{ slug: "a", note: "two" }, { slug: "b", note: null }]);

    const deleted = await runPgRowChanges(url, [
      { kind: "delete", table, key: { slug: "b" }, expected: { slug: "b", note: null } },
    ]);
    expect(deleted.rowsAffected).toBe(1);

    await runPgExec(url, `DROP TABLE ${T}_mut`);
  });
});
