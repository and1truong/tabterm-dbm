import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { migrations } from "./migrations.ts";
import { makeConnections } from "./connections.ts";

function freshDb() {
  const db = new Database(":memory:");
  for (const m of migrations) m.up(db);
  return db;
}

test("save then get round-trips a connection", () => {
  const c = makeConnections(freshDb());
  const saved = c.save("local", "postgres://u:p@h:5432/db");
  expect(saved.id).toBeTruthy();
  expect(saved.label).toBe("local");
  expect(saved.url).toBe("postgres://u:p@h:5432/db");
  expect(c.get(saved.id)?.label).toBe("local");
});

test("save with explicit id upserts (label/url overwritten)", () => {
  const c = makeConnections(freshDb());
  c.save("a", "postgres://1", "fixed");
  const again = c.save("b", "postgres://2", "fixed");
  expect(again.id).toBe("fixed");
  expect(again.label).toBe("b");
  expect(c.list().length).toBe(1);
});

test("list orders touched connections before untouched", () => {
  const c = makeConnections(freshDb());
  const a = c.save("a", "postgres://a");
  c.save("b", "postgres://b");
  c.touch(a.id);
  expect(c.list()[0].id).toBe(a.id);
});

test("delete returns true then false", () => {
  const c = makeConnections(freshDb());
  const s = c.save("x", "postgres://x");
  expect(c.delete(s.id)).toBe(true);
  expect(c.delete(s.id)).toBe(false);
  expect(c.get(s.id)).toBeNull();
});
