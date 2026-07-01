import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { PgConnection } from "../shared.ts";

interface PgConnectionRow {
  id: string; label: string; url: string;
  created_at: number; last_used_at: number | null;
}
const toPgConnection = (r: PgConnectionRow): PgConnection => ({
  id: r.id, label: r.label, url: r.url, createdAt: r.created_at, lastUsedAt: r.last_used_at,
});

export interface Connections {
  list(): PgConnection[];
  get(id: string): PgConnection | null;
  save(label: string, url: string, id?: string): PgConnection;
  touch(id: string): void;
  delete(id: string): boolean;
}

export function makeConnections(db: Database): Connections {
  const api: Connections = {
    list: () =>
      db.query<PgConnectionRow, []>("SELECT * FROM pg_connections ORDER BY last_used_at DESC NULLS LAST, label")
        .all().map(toPgConnection),
    get: (id) => {
      const r = db.query<PgConnectionRow, [string]>("SELECT * FROM pg_connections WHERE id = ?").get(id);
      return r ? toPgConnection(r) : null;
    },
    save: (label, url, id = randomUUID()) => {
      db.query(
        "INSERT INTO pg_connections (id, label, url) VALUES (?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET label = excluded.label, url = excluded.url",
      ).run(id, label, url);
      const saved = api.get(id);
      if (!saved) throw new Error("save failed");
      return saved;
    },
    touch: (id) => { db.query("UPDATE pg_connections SET last_used_at = unixepoch() WHERE id = ?").run(id); },
    delete: (id) => db.query("DELETE FROM pg_connections WHERE id = ?").run(id).changes > 0,
  };
  return api;
}
