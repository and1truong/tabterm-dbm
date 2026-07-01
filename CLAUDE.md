# tabterm-dbm

The **database** module for [tabterm](https://github.com/and1truong/tabterm), extracted
into its own repository — browse SQLite files or connect to Postgres: object tree, filter
builder, SQL tab, Create View (`id: dbm`). A tabterm *module*, not a standalone app: it has
no server/SPA of its own; it activates inside a tabterm host through the
`@tabterm/module-host` contract.

## Toolchain

- **Runtime + package manager: [Bun](https://bun.sh)** (required ≥1.3.5, see `package.json` engines).
  Use `bun` for everything. Do **not** use `npm`, `yarn`, or `pnpm`. Lockfile is `bun.lock`.
- **Typecheck:** `bun run typecheck` (`tsc --noEmit`) — or `make typecheck`.
- **Test:** `bun test` (sqlite/pg server + filter tests) — or `make test`.
- **Full local gate:** `make check` (typecheck + test).
- **Build:** `make build` → `dist/modules/dbm/{client.js,server.js}`.
- `make help` lists every target.

## Architecture

The module talks to the host **only** through `@tabterm/module-host` plus its own files —
no deep imports into a host's `src/`. It owns everything it needs:

- `shared.ts` — HTTP JSON shapes shared by the module's server endpoints and client
  (`DbFile`, `DbSchema`, `DbTable`, `QueryResult`, `ExecResult`, `PgConnection`, `DbError`).
- `server.ts` — server entry: `activate(host)` runs the migration (its own
  `pg_connections` table), then registers the `/discover`, `/schema`, `/query`, `/exec`,
  and `/connections` routes under `/api/modules/dbm/r`.
  - `server/dbServer.ts` — SQLite discovery/schema/query/exec + `assertReadOnly`.
  - `server/pgServer.ts` — Postgres half via Bun's built-in client (`Bun.SQL`); no `pg`
    dependency. Rewrites `?` placeholders to `$n` for Postgres.
  - `server/connections.ts` — saved Postgres-connection CRUD backed by `host.db`.
  - `server/routeHandlers.ts` — dispatches each HTTP route to the sqlite/pg core.
  - `server/migrations.ts` — v1 creates `pg_connections`.
- `src/index.tsx` — client entry: `activate(host)` registers one rail page (`id: dbm`,
  Database icon) rendering `WorkspaceDatabaseView`.
  - `src/WorkspaceDatabaseView.tsx` — the main view; `src/dbApi.ts` is the typed HTTP
    client; `src/dbFilter.ts` builds WHERE clauses; the `Database*Modal`/`Notice` files are
    the open/create-view/filter UI.

See `README.md`.

## Host contract (`@tabterm/module-host`)

- **Vendored** under `vendor/module-host/`, resolved via `file:./vendor/module-host` — no
  registry dependency. Pinned to `0.8.0` (see `vendor/README.md`).
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
