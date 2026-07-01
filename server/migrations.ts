import type { Migration } from "@tabterm/module-host/server";

export const migrations: Migration[] = [
  {
    v: 1,
    up: (db) => {
      // Remembered Postgres connections for the dbm picker. `url` may carry a
      // plaintext password — this is the user-chosen "remember connection"
      // behaviour for a local-only app.
      db.exec(`CREATE TABLE IF NOT EXISTS pg_connections (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        url TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_used_at INTEGER
      )`);
    },
  },
];
