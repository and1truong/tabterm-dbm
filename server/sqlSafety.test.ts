import { describe, expect, test } from "bun:test";
import { assertReadOnlySql, boundReadSql, sqlTokens } from "./sqlSafety.ts";
import { DbError } from "../shared.ts";

describe("SQL read-only safety", () => {
  test("ignores keywords and semicolons in strings, identifiers, and comments", () => {
    expect(sqlTokens(`/* DELETE; */ SELECT 'UPDATE;' AS "DROP"`)).toEqual(["SELECT", "AS"]);
    expect(assertReadOnlySql(`/* inspect */ SELECT 'value;';`)).toBe(`/* inspect */ SELECT 'value;'`);
  });

  test("ignores PostgreSQL dollar-quoted bodies", () => {
    expect(assertReadOnlySql("SELECT $$ DELETE; UPDATE $$ AS body")).toBe("SELECT $$ DELETE; UPDATE $$ AS body");
    expect(assertReadOnlySql("SELECT $tag$ DROP TABLE x; $tag$ AS body")).toContain("SELECT");
  });

  test("rejects write operations nested under WITH and EXPLAIN", () => {
    expect(() => assertReadOnlySql("WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x"))
      .toThrow(DbError);
    expect(() => assertReadOnlySql("EXPLAIN ANALYZE UPDATE t SET n = 1"))
      .toThrow(DbError);
  });

  test("rejects multiple statements but accepts one trailing terminator", () => {
    expect(() => assertReadOnlySql("SELECT 1; SELECT 2"))
      .toThrow(DbError);
    expect(assertReadOnlySql("SELECT 1;")).toBe("SELECT 1");
  });

  test("wraps row-producing reads with one look-ahead row", () => {
    expect(boundReadSql("SELECT * FROM t", 50, 100)).toBe(
      `SELECT * FROM (SELECT * FROM t) AS "__tabterm_query" LIMIT 51 OFFSET 100`,
    );
  });

  test("allows catalog PRAGMAs but rejects state-changing PRAGMAs", () => {
    expect(boundReadSql("PRAGMA table_info(users)", 10)).toBe("PRAGMA table_info(users)");
    expect(() => assertReadOnlySql("PRAGMA foreign_keys = OFF")).toThrow(DbError);
    expect(() => assertReadOnlySql("PRAGMA writable_schema")).toThrow(DbError);
  });
});
