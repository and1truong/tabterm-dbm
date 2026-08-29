import type { Connections } from "./connections.ts";
import { createDatabase, discoverDatabases, explainQuery, readInsights, readSchema, runMigration, runQuery, runExec, runRowChanges } from "./dbServer.ts";
import { explainPgQuery, readPgInsights, readPgSchema, runPgMigration, runPgQuery, runPgExec, runPgRowChanges, testPgConnection } from "./pgServer.ts";
import { compileRowChanges } from "./rowMutations.ts";
import type { RowChange } from "../shared.ts";
import { DbError } from "../shared.ts";

// A request targets either a SQLite file (`path`) or a saved Postgres
// connection (`connId`). For Postgres the full url — which may carry a password
// — is resolved server-side from pg_connections, so it never rides on a request.
export function makeHandlers(conns: Connections) {
  const environments = new Set(["local", "development", "staging", "production"]);
  const resolvePgUrl = async (connId: string): Promise<string> => {
    const url = await conns.resolveUrl(connId);
    if (!url) throw new DbError("not_found", "unknown postgres connection");
    return url;
  };
  const assertPgWritable = async (connId: string) => {
    const connection = await conns.get(connId);
    if (!connection) throw new DbError("not_found", "unknown postgres connection");
    if (connection.readOnly) throw new DbError("not_read_only", `connection "${connection.label}" is read-only`);
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
      const status = e.code === "not_found" ? 404
        : e.code === "timeout" || e.code === "cancelled" ? 408
        : e.code === "conflict" ? 409
        : 400;
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

    async create(req: Request): Promise<Response> {
      let b: { path?: string };
      try { b = await req.json() as typeof b; } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
      try { return Response.json(createDatabase(b.path ?? "")); }
      catch (error) { return dbErrorResponse(error); }
    },

    // GET /schema?path=<abs> | ?connId=<id> -> DbSchema
    async schema(url: URL): Promise<Response> {
      const connId = url.searchParams.get("connId");
      try {
        if (connId) return Response.json(await readPgSchema(await resolvePgUrl(connId)));
        return Response.json(readSchema(url.searchParams.get("path") ?? ""));
      } catch (e) { return dbErrorResponse(e); }
    },

    async insights(url: URL): Promise<Response> {
      const connId = url.searchParams.get("connId");
      try {
        if (connId) return Response.json(await readPgInsights(await resolvePgUrl(connId)));
        return Response.json(readInsights(url.searchParams.get("path") ?? ""));
      } catch (error) { return dbErrorResponse(error); }
    },

    // POST /query  body { path? | connId?, sql, params?, limit? }
    async query(req: Request): Promise<Response> {
      let b: { path?: string; connId?: string; sql?: string; params?: unknown[]; limit?: number; offset?: number; timeoutMs?: number };
      try { b = await req.json() as typeof b; } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
      try {
        if (b.connId) return Response.json(await runPgQuery(await resolvePgUrl(b.connId), b.sql ?? "", b.params ?? [], b.limit, b.offset, req.signal, b.timeoutMs));
        return Response.json(runQuery(b.path ?? "", b.sql ?? "", b.params ?? [], b.limit, b.offset));
      } catch (e) { return dbErrorResponse(e); }
    },

    async explain(req: Request): Promise<Response> {
      let b: { path?: string; connId?: string; sql?: string; params?: unknown[]; timeoutMs?: number };
      try { b = await req.json() as typeof b; } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
      try {
        if (b.connId) return Response.json(await explainPgQuery(await resolvePgUrl(b.connId), b.sql ?? "", b.params ?? [], req.signal, b.timeoutMs));
        return Response.json(explainQuery(b.path ?? "", b.sql ?? "", b.params ?? []));
      } catch (error) { return dbErrorResponse(error); }
    },

    async migration(req: Request, apply: boolean): Promise<Response> {
      let b: { path?: string; connId?: string; sql?: string; allowWrite?: boolean; timeoutMs?: number };
      try { b = await req.json() as typeof b; } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
      try {
        if (apply && b.allowWrite !== true) throw new DbError("not_read_only", "migration apply requires explicit confirmation");
        if (b.connId) {
          if (apply) await assertPgWritable(b.connId);
          return Response.json(await runPgMigration(await resolvePgUrl(b.connId), b.sql ?? "", apply, b.timeoutMs));
        }
        return Response.json(runMigration(b.path ?? "", b.sql ?? "", apply));
      } catch (error) { return dbErrorResponse(error); }
    },

    // POST /exec  body { path? | connId?, sql }
    async exec(req: Request): Promise<Response> {
      let b: { path?: string; connId?: string; sql?: string; allowWrite?: boolean };
      try { b = await req.json() as typeof b; } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
      try {
        if (b.allowWrite !== true) throw new DbError("not_read_only", "write execution requires explicit confirmation");
        if (b.connId) {
          await assertPgWritable(b.connId);
          return Response.json(await runPgExec(await resolvePgUrl(b.connId), b.sql ?? ""));
        }
        return Response.json(runExec(b.path ?? "", b.sql ?? ""));
      } catch (e) { return dbErrorResponse(e); }
    },

    async rowPreview(req: Request): Promise<Response> {
      let b: { changes?: RowChange[] };
      try { b = await req.json() as typeof b; } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
      try {
        return Response.json({ statements: compileRowChanges(b.changes ?? []) });
      } catch (e) { return dbErrorResponse(e); }
    },

    async rowApply(req: Request): Promise<Response> {
      let b: { path?: string; connId?: string; changes?: RowChange[]; allowWrite?: boolean; timeoutMs?: number };
      try { b = await req.json() as typeof b; } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
      try {
        if (b.allowWrite !== true) throw new DbError("not_read_only", "row changes require explicit confirmation");
        const changes = b.changes ?? [];
        if (b.connId) {
          await assertPgWritable(b.connId);
          return Response.json(await runPgRowChanges(await resolvePgUrl(b.connId), changes, req.signal, b.timeoutMs));
        }
        return Response.json(runRowChanges(b.path ?? "", changes));
      } catch (e) { return dbErrorResponse(e); }
    },

    // GET /connections -> { connections: PgConnection[] } (passwords redacted)
    async connectionsList(): Promise<Response> {
      const connections = (await conns.list()).map((c) => ({ ...c, url: redactUrl(c.url) }));
      return Response.json({ connections });
    },

    // POST /connections  body { label, url } -> PgConnection (redacted)
    async connectionSave(req: Request): Promise<Response> {
      let b: { label?: string; url?: string; environment?: string; readOnly?: boolean };
      try { b = await req.json() as typeof b; } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
      const url = (b.url ?? "").trim();
      const label = (b.label ?? "").trim() || url;
      if (!url) return Response.json({ error: "url is required" }, { status: 400 });
      const environment = environments.has(b.environment ?? "")
        ? b.environment as "local" | "development" | "staging" | "production"
        : "development";
      const saved = await conns.save(label, url, { environment, readOnly: b.readOnly !== false });
      conns.touch(saved.id);
      return Response.json({ ...saved, url: redactUrl(saved.url) });
    },

    async connectionTest(req: Request): Promise<Response> {
      let b: { url?: string; connId?: string };
      try { b = await req.json() as typeof b; } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
      try {
        const url = b.connId ? await resolvePgUrl(b.connId) : (b.url ?? "").trim();
        if (!url) throw new DbError("not_found", "connection url is required");
        return Response.json(await testPgConnection(url, req.signal));
      } catch (e) { return dbErrorResponse(e); }
    },

    // DELETE /connections?id=<id> -> { ok }
    async connectionDelete(url: URL): Promise<Response> {
      const id = url.searchParams.get("id") ?? "";
      return Response.json({ ok: await conns.delete(id) });
    },
  };
}
