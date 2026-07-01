import type { Connections } from "./connections.ts";
import { discoverDatabases, readSchema, runQuery, runExec } from "./dbServer.ts";
import { readPgSchema, runPgQuery, runPgExec } from "./pgServer.ts";
import { DbError } from "../shared.ts";

// A request targets either a SQLite file (`path`) or a saved Postgres
// connection (`connId`). For Postgres the full url — which may carry a password
// — is resolved server-side from pg_connections, so it never rides on a request.
export function makeHandlers(conns: Connections) {
  const resolvePgUrl = (connId: string): string => {
    const c = conns.get(connId);
    if (!c) throw new DbError("not_found", "unknown postgres connection");
    return c.url;
  };

  // Strip the password from a connection url for display, keeping host/db visible.
  const redactUrl = (url: string): string => {
    try {
      const u = new URL(url);
      if (u.password) u.password = "***";
      return u.toString();
    } catch { return url; }
  };

  const dbErrorResponse = (e: unknown): Response => {
    if (e instanceof DbError) {
      const status = e.code === "not_found" ? 404 : 400;
      return Response.json({ error: e.message, code: e.code }, { status });
    }
    return Response.json({ error: e instanceof Error ? e.message : "db error" }, { status: 400 });
  };

  return {
    // GET /discover?cwd=<abs> -> { databases: DbFile[] }
    discover(url: URL): Response {
      const cwd = url.searchParams.get("cwd") ?? "";
      return Response.json({ databases: discoverDatabases(cwd) });
    },

    // GET /schema?path=<abs> | ?connId=<id> -> DbSchema
    async schema(url: URL): Promise<Response> {
      const connId = url.searchParams.get("connId");
      try {
        if (connId) return Response.json(await readPgSchema(resolvePgUrl(connId)));
        return Response.json(readSchema(url.searchParams.get("path") ?? ""));
      } catch (e) { return dbErrorResponse(e); }
    },

    // POST /query  body { path? | connId?, sql, params?, limit? }
    async query(req: Request): Promise<Response> {
      let b: { path?: string; connId?: string; sql?: string; params?: unknown[]; limit?: number };
      try { b = await req.json() as typeof b; } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
      try {
        if (b.connId) return Response.json(await runPgQuery(resolvePgUrl(b.connId), b.sql ?? "", b.params ?? [], b.limit));
        return Response.json(runQuery(b.path ?? "", b.sql ?? "", b.params ?? [], b.limit));
      } catch (e) { return dbErrorResponse(e); }
    },

    // POST /exec  body { path? | connId?, sql }
    async exec(req: Request): Promise<Response> {
      let b: { path?: string; connId?: string; sql?: string };
      try { b = await req.json() as typeof b; } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
      try {
        if (b.connId) return Response.json(await runPgExec(resolvePgUrl(b.connId), b.sql ?? ""));
        return Response.json(runExec(b.path ?? "", b.sql ?? ""));
      } catch (e) { return dbErrorResponse(e); }
    },

    // GET /connections -> { connections: PgConnection[] } (passwords redacted)
    connectionsList(): Response {
      const connections = conns.list().map((c) => ({ ...c, url: redactUrl(c.url) }));
      return Response.json({ connections });
    },

    // POST /connections  body { label, url } -> PgConnection (redacted)
    async connectionSave(req: Request): Promise<Response> {
      let b: { label?: string; url?: string };
      try { b = await req.json() as typeof b; } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
      const url = (b.url ?? "").trim();
      const label = (b.label ?? "").trim() || url;
      if (!url) return Response.json({ error: "url is required" }, { status: 400 });
      const saved = conns.save(label, url);
      conns.touch(saved.id);
      return Response.json({ ...saved, url: redactUrl(saved.url) });
    },

    // DELETE /connections?id=<id> -> { ok }
    connectionDelete(url: URL): Response {
      const id = url.searchParams.get("id") ?? "";
      return Response.json({ ok: conns.delete(id) });
    },
  };
}
