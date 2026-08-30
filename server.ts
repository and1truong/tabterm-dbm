// Database management module — server half. Ports the core /api/db/* routes:
// SQLite discovery/schema/query/exec (dbServer) + Postgres (pgServer), plus the
// saved-connection picker backed by the module's own pg_connections table.
import type { ServerHost } from "@tabterm/module-host/server";
import { migrations } from "./server/migrations.ts";
import { makeConnections } from "./server/connections.ts";
import { makeHandlers } from "./server/routeHandlers.ts";

export default function activate(host: ServerHost): () => void {
  host.migrate(migrations);
  const h = makeHandlers(makeConnections(host.db));

  host.registerRoute("GET",    "/discover",    (req) => h.discover(new URL(req.url)));
  host.registerRoute("POST",   "/create",      (req) => h.create(req));
  host.registerRoute("GET",    "/schema",      (req) => h.schema(new URL(req.url)));
  host.registerRoute("GET",    "/insights",    (req) => h.insights(new URL(req.url)));
  host.registerRoute("POST",   "/query",       (req) => h.query(req));
  host.registerRoute("POST",   "/explain",     (req) => h.explain(req));
  host.registerRoute("POST",   "/migration/preview", (req) => h.migration(req, false));
  host.registerRoute("POST",   "/migration/apply",   (req) => h.migration(req, true));
  host.registerRoute("POST",   "/exec",        (req) => h.exec(req));
  host.registerRoute("POST",   "/rows/preview",(req) => h.rowPreview(req));
  host.registerRoute("POST",   "/rows/apply",  (req) => h.rowApply(req));
  host.registerRoute("GET",    "/connections", ()    => h.connectionsList());
  host.registerRoute("POST",   "/connections", (req) => h.connectionSave(req));
  host.registerRoute("POST",   "/connections/test", (req) => h.connectionTest(req));
  host.registerRoute("DELETE", "/connections", (req) => h.connectionDelete(new URL(req.url)));
  return () => {};
}
