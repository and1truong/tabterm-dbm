# @tabterm/module-dbm

The **database** module for [tabterm](https://github.com/and1truong/tabterm) (`id: dbm`) —
a mode-rail view for browsing databases:

- **SQLite** — discovers `*.db`/`*.sqlite` files under the workspace cwd; object tree
  (tables + views), schema/DDL, indexes, triggers, pragmas.
- **Postgres** — connect by URL via Bun's built-in client (`Bun.SQL`); remembered
  connections are saved in tabterm's own SQLite DB (the module's `pg_connections` table).
- **Query + browse** — read-only `SELECT` runner, a visual filter builder (WHERE
  clauses), a raw SQL tab, and a Create View helper.

Extracted from the tabterm monorepo (`modules/dbm/`) into its own repository.

## Layout

```
shared.ts                  HTTP JSON shapes shared by server + client (DbSchema,
                           QueryResult, PgConnection, DbError, …)
server.ts                  Server entry — activate(host): migration + route registration
server/dbServer.ts         SQLite discovery/schema/query/exec + assertReadOnly
server/pgServer.ts         Postgres half via Bun.SQL (no `pg` dependency)
server/connections.ts      Saved Postgres-connection CRUD (host.db)
server/routeHandlers.ts    Route dispatch to the sqlite/pg core
server/migrations.ts       v1: pg_connections table
src/index.tsx              Client entry — activate(host): registers the dbm rail page
src/WorkspaceDatabaseView.tsx   The main view
src/dbApi.ts               Typed HTTP client (/api/modules/dbm/r/*)
src/dbFilter.ts            WHERE-clause builder
src/Database*Modal.tsx     Open / Create View / filter UI
scripts/build-modules.ts   Builds the two self-contained dist artifacts
```

The module talks to the host **only** through `@tabterm/module-host` (the type-only
contract) plus its own files — no deep imports into tabterm's `src/`. It owns its
persisted state (its own `pg_connections` table via `host.migrate`/`host.db`), its HTTP
routes (`host.registerRoute`), and its UI (`host.ui.registerUI`). See `docs/modules.md`
in tabterm for the full host API.

## Development

```sh
bun install        # resolves lucide-react + links @tabterm/module-host
bun run typecheck  # tsc --noEmit
bun test           # sqlite/pg server + filter tests
make build         # -> dist/modules/dbm/{client.js,server.js}
```

`@tabterm/module-host` (the type-only host contract) is **vendored** under
`vendor/module-host/` and resolved via `file:./vendor/module-host` (see `package.json`
devDependencies) — no npm/registry dependency. To update it, run
`make vendor TABTERM=<path-to-tabterm>`.

## Consuming this module in tabterm

Unlike a monorepo module, this repo builds its own artifacts. `make build` emits two
self-contained files under `dist/modules/dbm/`:

- **`client.js`** — ESM client bundle. `react`/`react-dom` stay external (host-provided at
  runtime); `lucide-react` is inlined. No CSS (Tailwind classes only). Default export is
  `activate(host)`.
- **`server.js`** — server half (`--target bun` ESM). Uses only Bun built-ins
  (`bun:sqlite`, `Bun.SQL`) and `node:*`. Default export is `activate(host)`.

Point tabterm's config at them:

```yaml
modules:
  - { id: dbm, enabled: true,
      client: ~/dirs/tabterm-modules/tabterm-dbm/dist/modules/dbm/client.js,
      server: ~/dirs/tabterm-modules/tabterm-dbm/dist/modules/dbm/server.js }
```

Rebuild here (`make build`) whenever the module changes; tabterm picks up the new bundles
on its next load.

### Install from a release

Each [release](https://github.com/and1truong/tabterm-dbm/releases) ships the two
self-contained files — no build step:

```sh
mkdir -p dist/modules/dbm
curl -L -o dist/modules/dbm/client.js \
  https://github.com/and1truong/tabterm-dbm/releases/latest/download/client.js
curl -L -o dist/modules/dbm/server.js \
  https://github.com/and1truong/tabterm-dbm/releases/latest/download/server.js
```

then wire the same `modules:` entry (pointing at wherever you dropped them).
