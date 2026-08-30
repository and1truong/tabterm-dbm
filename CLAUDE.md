# tabterm-dbm

The **database** module for [tabterm](https://github.com/and1truong/tabterm), extracted
into its own repository — manage SQLite and PostgreSQL with catalog search, safe data editing,
SQL consoles, import/export, query plans, transactional migrations, relationships, and insights (`id: dbm`). A tabterm *module*, not a standalone app: it has
no server/SPA of its own; it activates inside a tabterm host through the
`@tabterm/module-host` contract.

## Toolchain

- **Runtime + package manager: [Bun](https://bun.sh)** (required ≥1.3.5, see `package.json` engines).
  Use `bun` for everything. Do **not** use `npm`, `yarn`, or `pnpm`. Lockfile is `bun.lock`.
- **Typecheck:** `bun run typecheck` (`tsc --noEmit`) — or `make typecheck`.
- **Test:** `bun test` (sqlite/pg server + filter tests) — or `make test`.
- **Full local gate:** `make check` (build + typecheck + unit tests + happy-dom UI smokes).
- **Build:** `make build` → `dist/modules/dbm/{client.js,server.js}`.
- `make help` lists every target.

## Architecture

The module talks to the host **only** through `@tabterm/module-host` plus its own files —
no deep imports into a host's `src/`. It owns everything it needs:

- `shared.ts` — HTTP JSON shapes shared by the module's server endpoints and client
  (`DbFile`, `DbSchema`, `DbTable`, `QueryResult`, `PgConnection`, `DatabaseInsights`, `DbError`).
- `server.ts` — server entry: `activate(host)` runs the migration (its own
  `pg_connections` table), then registers its routes under `/api/modules/dbm/r`.
  - `server/dbServer.ts` — SQLite discovery/catalog/query/explain/mutation/insights.
  - `server/pgServer.ts` — PostgreSQL catalog/query/explain/mutation/insights via Bun's built-in
    client (`Bun.SQL`); no `pg` dependency. Rewrites `?` placeholders to `$n`.
  - `server/connections.ts` — profile metadata in `host.db`; credentials in `Bun.secrets`.
  - `server/routeHandlers.ts` — dispatches each HTTP route to the sqlite/pg core.
  - `server/migrations.ts` — owns versioned `pg_connections` migrations.
- `src/index.tsx` — client entry: `activate(host)` registers one rail page (`id: dbm`,
  Database icon) rendering `WorkspaceDatabaseView`.
  - `src/WorkspaceDatabaseView.tsx` — the main view; `src/dbApi.ts` is the typed HTTP
    client; `src/dbFilter.ts` builds WHERE clauses; `src/SqlWorkspace.tsx` owns SQL consoles;
    data transfer and relationship helpers remain pure and unit-tested.

See `README.md`.

## Host contract (`@tabterm/module-host`)

- **Vendored** under `vendor/module-host/`, resolved via `file:./vendor/module-host` — no
  registry dependency. Pinned to `0.14.0` (see `vendor/README.md`).
- Refresh it with `make vendor TABTERM=<path-to-tabterm>` when the contract changes, then
  bump `vendor/module-host/package.json`.
- `react` / `react-dom` are **host-provided** at runtime (externalized in the module
  build) — declared here as peer/dev deps for typecheck + tests only. `lucide-react` is a
  real dependency and is bundled into `client.js`. The server half uses only Bun built-ins
  (`bun:sqlite`, `Bun.SQL`) and `node:*` — nothing bundled.

## Building / consuming this module

This repo ships **source** and builds its own **self-contained** artifacts. `make build`
(`scripts/build-modules.ts`) compiles:
- `src/index.tsx` → `dist/modules/dbm/client.js` (ESM, react/react-dom external,
  no code-splitting, no CSS — Tailwind classes only);
- `server.ts` → `dist/modules/dbm/server.js` (`--target bun`).

A tabterm host loads these two files via its `modules:` config. See `README.md`.

## Conventions

- Surgical changes; match existing style. The module's clean host-only boundary is the
  whole point of the extraction — never reach back into a host's internals.
- Tests are colocated (`*.test.ts`).
