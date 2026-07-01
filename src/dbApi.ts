import type { DbFile, DbSchema, QueryResult, ExecResult, PgConnection } from "../shared.ts";

const API = "/api/modules/dbm/r";

export type DbSource =
  | { kind: "sqlite"; path: string }
  | { kind: "postgres"; connId: string; label: string; url: string };

function selector(src: DbSource): { path?: string; connId?: string } {
  return src.kind === "sqlite" ? { path: src.path } : { connId: src.connId };
}
function selectorQuery(src: DbSource): string {
  return src.kind === "sqlite"
    ? `path=${encodeURIComponent(src.path)}`
    : `connId=${encodeURIComponent(src.connId)}`;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = (j as { error?: string }).error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(asJson<T>);
}

export const dbApi = {
  discover: (cwd: string) =>
    fetch(`${API}/discover?cwd=${encodeURIComponent(cwd)}`).then(asJson<{ databases: DbFile[] }>),
  schema: (src: DbSource) =>
    fetch(`${API}/schema?${selectorQuery(src)}`).then(asJson<DbSchema>),
  query: (src: DbSource, sql: string, params: unknown[], limit: number) =>
    post<QueryResult>(`${API}/query`, { ...selector(src), sql, params, limit }),
  exec: (src: DbSource, sql: string) =>
    post<ExecResult>(`${API}/exec`, { ...selector(src), sql }),
  connections: {
    list: () => fetch(`${API}/connections`).then(asJson<{ connections: PgConnection[] }>),
    save: (label: string, url: string) => post<PgConnection>(`${API}/connections`, { label, url }),
    delete: (id: string) =>
      fetch(`${API}/connections?id=${encodeURIComponent(id)}`, { method: "DELETE" }).then(asJson<{ ok: boolean }>),
  },
};
