import { expect, test } from "bun:test";
import { parseCsv, serializeRows } from "./dataTransfer.ts";
import type { DbTable } from "../shared.ts";

const table: DbTable = { name: "users", schema: "public", type: "table", columns: [], rowCount: -1, ddl: "" };

test("exports result sets as CSV, JSON, Markdown, and executable INSERTs", () => {
  const rows = [{ id: 1, name: "Ada, Inc.", note: null }];
  expect(serializeRows("csv", ["id", "name", "note"], rows)).toBe('id,name,note\n1,"Ada, Inc.",');
  expect(serializeRows("json", ["id", "name", "note"], rows)).toContain('"name": "Ada, Inc."');
  expect(serializeRows("markdown", ["id", "name"], rows)).toContain("| 1 | Ada, Inc. |");
  expect(serializeRows("sql", ["id", "name", "note"], rows, table)).toBe('INSERT INTO "public"."users" ("id", "name", "note") VALUES (1, \'Ada, Inc.\', NULL);\n');
});

test("parses quoted CSV including commas, escaped quotes, and newlines", () => {
  expect(parseCsv('id,name,note\r\n1,"Ada, Inc.","said ""hi"""\r\n2,Grace,"two\nlines"')).toEqual({
    columns: ["id", "name", "note"],
    rows: [
      { id: "1", name: "Ada, Inc.", note: 'said "hi"' },
      { id: "2", name: "Grace", note: "two\nlines" },
    ],
  });
  expect(() => parseCsv("id,id\n1,2")).toThrow();
});
