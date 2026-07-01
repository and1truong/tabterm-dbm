import { describe, test, expect } from "bun:test";
import { toPgPlaceholders, readPgSchema, runPgQuery, runPgExec } from "./pgServer.ts";
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

  test("no placeholders is a no-op", () => {
    expect(toPgPlaceholders("SELECT 1")).toBe("SELECT 1");
  });
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
    await runPgExec(url, `CREATE TABLE ${T} (id serial PRIMARY KEY, email text NOT NULL, age int)`);
    const ins = await runPgExec(url, `INSERT INTO ${T} (email, age) VALUES ('a@x', 21), ('b@x', 9)`);
    expect(ins.rowsAffected).toBe(2);

    const schema = await readPgSchema(url);
    const tbl = schema.tables.find((t) => t.name === T);
    expect(tbl).toBeTruthy();
    expect(tbl!.columns.map((c) => c.name)).toEqual(["id", "email", "age"]);
    expect(tbl!.columns.find((c) => c.name === "id")!.pk).toBe(true);
    expect(tbl!.columns.find((c) => c.name === "email")!.notNull).toBe(true);
    expect(schema.pragmas.database).toBeTruthy();

    await runPgExec(url, `DROP TABLE ${T}`);
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
});
