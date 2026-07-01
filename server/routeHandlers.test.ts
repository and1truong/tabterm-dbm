import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrations } from "./migrations.ts";
import { makeConnections } from "./connections.ts";
import { makeHandlers } from "./routeHandlers.ts";

function handlers() {
  const db = new Database(":memory:");
  for (const m of migrations) m.up(db);
  return makeHandlers(makeConnections(db));
}

test("discover returns sqlite files in a dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dbm-"));
  const f = join(dir, "x.sqlite");
  new Database(f).close();
  try {
    const res = handlers().discover(new URL(`http://x/discover?cwd=${encodeURIComponent(dir)}`));
    const body = (await res.json()) as { databases: { name: string }[] };
    expect(body.databases.some((d) => d.name === "x.sqlite")).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("schema of a missing sqlite path maps DbError(not_found) to 404", async () => {
  const res = await handlers().schema(new URL("http://x/schema?path=/no/such/file.db"));
  expect(res.status).toBe(404);
  const body = (await res.json()) as { code?: string };
  expect(body.code).toBe("not_found");
});

test("query with a write verb maps DbError(not_read_only) to 400", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dbm-"));
  const f = join(dir, "y.sqlite");
  const d = new Database(f); d.exec("CREATE TABLE t(a)"); d.close();
  try {
    const req = new Request("http://x/query", { method: "POST", body: JSON.stringify({ path: f, sql: "DELETE FROM t" }) });
    const res = await handlers().query(req);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("not_read_only");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("connections save→list redacts the password, delete removes it", async () => {
  const h = handlers();
  const saveRes = await h.connectionSave(
    new Request("http://x/connections", { method: "POST", body: JSON.stringify({ label: "l", url: "postgres://u:secret@h/db" }) }),
  );
  const saved = (await saveRes.json()) as PgConnectionShape;
  expect(saved.url).not.toContain("secret");

  const listRes = h.connectionsList();
  const list = (await listRes.json()) as { connections: PgConnectionShape[] };
  expect(list.connections[0].url).not.toContain("secret");

  const delRes = h.connectionDelete(new URL(`http://x/connections?id=${saved.id}`));
  expect(((await delRes.json()) as { ok: boolean }).ok).toBe(true);
});

type PgConnectionShape = { id: string; url: string };
