import { useEffect, useState, useCallback, useRef } from "react";
import { Database as DbIcon, RefreshCw, Plus, ChevronDown, Table2, Eye, GitBranch, Filter as FilterIcon, Play } from "lucide-react";
import type { ClientHost } from "@tabterm/module-host/client";
import Notice from "./Notice.tsx";
import { dbApi } from "./dbApi.ts";
import type { DbSource } from "./dbApi.ts";
import { compileGroup, previewWhere, groupHasActive, newGroup } from "./dbFilter.ts";
import type { FilterModel } from "./dbFilter.ts";
import { DatabaseOpenModal } from "./DatabaseOpenModal.tsx";
import { DatabaseFilterBuilder } from "./DatabaseFilterBuilder.tsx";
import { DatabaseCreateViewModal } from "./DatabaseCreateViewModal.tsx";
import type { DbFile, DbSchema, DbTable, DbColumn, QueryResult } from "../shared.ts";

// Short label for the database chip in the header.
function sourceChip(src: DbSource | null): string {
  if (!src) return "(no database)";
  if (src.kind === "sqlite") return src.path.split("/").pop() ?? src.path;
  return src.label;
}

type Pane = "structure" | "data" | "sql" | "pragmas";

export function WorkspaceDatabaseView({ host, tabId }: { host: ClientHost; tabId: string }) {
  // cwd is read reactively from the host's app-state projection (not the core
  // store, which modules can't import). Re-renders on cwd change, preserving the
  // auto-discover / auto-select-first-SQLite behaviour. Prefer the active
  // workspace's cwd; fall back to this tab's own entry.
  const cwd = host.context.select((s) =>
    (s.activeWorkspaceId ? s.workspaces[s.activeWorkspaceId]?.cwd : s.workspaces[tabId]?.cwd) ?? "",
  );

  const [dbs, setDbs] = useState<DbFile[]>([]);
  const [activeSource, setActiveSource] = useState<DbSource | null>(null);
  const [schema, setSchema] = useState<DbSchema | null>(null);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("data");
  const [writable, setWritable] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<false | "open" | "create">(false);
  const [filterModel, setFilterModel] = useState<FilterModel>(() => newGroup());
  const [filterOpen, setFilterOpen] = useState(false);
  const [createViewOpen, setCreateViewOpen] = useState(false);

  // discover on cwd change
  const refreshDbs = useCallback(async () => {
    if (!cwd) return;
    try { setDbs((await dbApi.discover(cwd)).databases); } catch (e) { setErr(String(e)); }
  }, [cwd]);
  useEffect(() => { void refreshDbs(); }, [refreshDbs]);

  // A source's identity for effect deps: distinguishes both kind and target.
  const sourceKey = activeSource
    ? activeSource.kind === "sqlite" ? `sqlite:${activeSource.path}` : `postgres:${activeSource.connId}`
    : null;

  // load schema when a db is chosen
  useEffect(() => {
    if (!activeSource) { setSchema(null); return; }
    let cancel = false;
    dbApi.schema(activeSource).then((s) => { if (!cancel) { setSchema(s); setActiveTable(s.tables[0]?.name ?? null); } })
      .catch((e) => !cancel && setErr(String(e)));
    return () => { cancel = true; };
  }, [sourceKey]);

  // Latest compiled query for the active table + filter. Recomputed each render
  // (cheap) so the debounced reload always fires against current state, dodging
  // stale-closure issues inside the async loadRows. The `?` placeholders and
  // double-quoted identifier are valid for both SQLite and Postgres (the server
  // rewrites `?`→`$n` for Postgres).
  const activeTbl: DbTable | undefined = schema?.tables.find((t) => t.name === activeTable);
  const queryRef = useRef<{ sql: string; params: unknown[] } | null>(null);
  if (activeSource && activeTable && activeTbl) {
    const { where, params } = compileGroup(filterModel, activeTbl.columns);
    const base = `SELECT * FROM "${activeTable.replace(/"/g, '""')}"`;
    queryRef.current = { sql: where ? `${base} WHERE ${where} LIMIT 1000` : `${base} LIMIT 1000`, params };
  } else {
    queryRef.current = null;
  }

  const loadRows = useCallback(async () => {
    if (!activeSource || !queryRef.current) return;
    setErr(null);
    try {
      const r = await dbApi.query(activeSource, queryRef.current.sql, queryRef.current.params, 1000);
      setResult(r);
    } catch (e) { setResult(null); setErr(String(e)); }
  }, [sourceKey]);

  // Fresh table → fresh filter + drop stale rows.
  useEffect(() => { setFilterModel(newGroup()); setResult(null); }, [activeTable]);

  // Debounced reload: pane switch, db/table change, or filter edit.
  useEffect(() => {
    if (pane !== "data" || !activeSource || !activeTable) return;
    const t = setTimeout(() => { void loadRows(); }, 150);
    return () => clearTimeout(t);
  }, [pane, sourceKey, activeTable, filterModel, loadRows]);

  // auto-pick the first discovered sqlite db (Postgres requires explicit connect)
  useEffect(() => { if (!activeSource && dbs.length) setActiveSource({ kind: "sqlite", path: dbs[0].path }); }, [dbs, activeSource]);

  // Re-fetch schema after a write (create view, SQL-tab exec) so the tree updates.
  const reloadSchema = useCallback(() => {
    if (!activeSource) return;
    dbApi.schema(activeSource).then(setSchema).catch((e) => setErr(String(e)));
  }, [sourceKey]);

  const dbChip = sourceChip(activeSource);

  return (
    <div className="flex-1 flex flex-col min-h-0 float-card overflow-hidden">
      <DbHeader cwd={cwd} dbChip={dbChip} tableCount={schema?.tables.length ?? 0}
        writable={writable} onToggleRw={() => setWritable((w) => !w)}
        onPick={() => setPickerOpen("open")} onCreate={() => setPickerOpen("create")} onRefresh={() => void refreshDbs()}
        filterOpen={filterOpen} onToggleFilter={() => setFilterOpen((v) => !v)} filterActive={groupHasActive(filterModel)}
        canNewView={writable && !!activeSource} onNewView={() => setCreateViewOpen(true)} />

      <div className="flex gap-1 px-3 pt-1.5 bg-[var(--bg)]">
        {(["structure", "data", "sql", "pragmas"] as Pane[]).map((t) => (
          <button key={t} onClick={() => setPane(t)}
            className={"px-3 py-1.5 text-xs font-bold rounded-t-lg " + (pane === t ? "bg-[var(--panel)] text-[var(--text)] border border-[var(--border)] border-b-0" : "text-[var(--muted)]")}>
            {t === "data" ? "Browse Data" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 grid bg-[var(--panel)] border-t border-[var(--border)]" style={{ gridTemplateColumns: "212px 1fr" }}>
        <ObjectTree schema={schema} activeTable={activeTable} onSelect={setActiveTable} />
        <div className="flex flex-col min-w-0">
          {err && <Notice variant="error" layout="inline" className="px-3 py-2 text-xs">{err}</Notice>}
          {pane === "data" && activeTbl && (
            <>
              {filterOpen && (
                <>
                  <DatabaseFilterBuilder model={filterModel} cols={activeTbl.columns} onChange={setFilterModel} />
                  <div className="px-3 py-1 border-b border-[var(--border)] bg-[var(--bg)]">
                    <span className="mono text-[11px] text-[var(--muted)]">
                      <b className="text-[var(--accent)]">WHERE</b>{" "}
                      {previewWhere(filterModel, activeTbl.columns) || <i className="text-[var(--faint)]">no filter</i>}
                    </span>
                  </div>
                </>
              )}
              <DataGrid columns={activeTbl.columns.map((c) => c.name)} result={result} />
            </>
          )}
          {pane === "structure" && activeTbl && <StructurePane table={activeTbl} />}
          {pane === "pragmas" && schema && <PragmasPane pragmas={schema.pragmas} />}
          {pane === "sql" && activeSource && <SqlPane source={activeSource} writable={writable} onExeced={reloadSchema} />}
          {pane === "data" && !activeTbl && <EmptyHint text="Select a table or view to browse its rows." />}
          {pane === "structure" && !activeTbl && <EmptyHint text="Select a table or view to inspect its structure." />}
          {pane === "pragmas" && !schema && <EmptyHint text="Open a database to view its pragmas." />}
          {pane === "sql" && !activeSource && <EmptyHint text="Open a database to run SQL." />}
        </div>
      </div>

      {pickerOpen && (
        <DatabaseOpenModal cwd={cwd} discovered={dbs} create={pickerOpen === "create"}
          onClose={() => setPickerOpen(false)}
          onOpen={(src) => { setActiveSource(src); setPickerOpen(false); void refreshDbs(); }} />
      )}
      {createViewOpen && activeSource && (
        <DatabaseCreateViewModal source={activeSource}
          onClose={() => setCreateViewOpen(false)} onCreated={() => { void reloadSchema(); }} />
      )}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div className="flex-1 grid place-items-center text-[var(--faint)] text-xs px-6 text-center">{text}</div>;
}

function DbHeader({ cwd, dbChip, tableCount, writable, onToggleRw, onPick, onCreate, onRefresh, filterOpen, onToggleFilter, filterActive, canNewView, onNewView }: {
  cwd: string; dbChip: string; tableCount: number;
  writable: boolean; onToggleRw: () => void; onPick: () => void; onCreate: () => void; onRefresh: () => void;
  filterOpen: boolean; onToggleFilter: () => void; filterActive: boolean;
  canNewView: boolean; onNewView: () => void;
}) {
  const short = cwd ? cwd.replace(/^\/Users\/[^/]+/, "~") : "~";
  return (
    <div className="flex items-center gap-2 px-3 h-11 border-b border-[var(--border)] bg-[var(--bg)]">
      <span className="mono text-[11px] text-[var(--faint)] truncate max-w-[280px]" title={cwd}>{short}</span>
      <button onClick={onPick}
        className="flex items-center gap-1.5 px-2.5 h-7 rounded-md border border-[var(--border-2)] hover:border-[var(--accent)] text-[var(--text)] text-xs font-semibold"
        title="Switch database">
        <DbIcon size={13} className="text-[var(--accent)]" />
        <span className="truncate max-w-[220px]">{dbChip.split("/").pop() ?? dbChip}</span>
        <span className="text-[var(--faint)] font-normal">{tableCount}</span>
        <ChevronDown size={13} className="text-[var(--muted)]" />
      </button>

      <div className="flex items-center rounded-md border border-[var(--border-2)] overflow-hidden h-7">
        <button onClick={() => !writable && onToggleRw()}
          className={"px-2 text-[11px] font-semibold h-full " + (!writable ? "bg-[var(--accent)] text-[var(--panel)]" : "text-[var(--muted)]")}>Read-only</button>
        <button onClick={() => writable && onToggleRw()}
          className={"px-2 text-[11px] font-semibold h-full " + (writable ? "bg-[var(--accent)] text-[var(--panel)]" : "text-[var(--muted)]")}>Writable</button>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button onClick={onToggleFilter} title="Filter rows (Browse Data)"
          className={"flex items-center gap-1 px-2.5 h-7 rounded-md text-xs font-semibold border " + (filterOpen || filterActive ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border-2)] text-[var(--muted)] hover:bg-[var(--hover)]")}>
          <FilterIcon size={13} /> Filter
        </button>
        <button onClick={onNewView} disabled={!canNewView}
          title={canNewView ? "Create a new SQL view" : "Flip Read-only → Writable to create a view"}
          className={"flex items-center gap-1 px-2.5 h-7 rounded-md text-xs font-semibold " + (canNewView ? "text-[var(--accent)] hover:bg-[var(--hover)]" : "text-[var(--muted)] opacity-50 cursor-not-allowed")}>
          <Plus size={13} /> New view
        </button>
        <button onClick={onRefresh} title="Rescan workspace"
          className="flex items-center gap-1 px-2.5 h-7 rounded-md text-xs font-semibold text-[var(--muted)] border border-[var(--border-2)] hover:bg-[var(--hover)]">
          <RefreshCw size={13} /> Refresh
        </button>
        <button onClick={onCreate} title="Create a new database"
          className="flex items-center gap-1 px-2.5 h-7 rounded-md text-xs font-bold bg-[var(--accent)] text-[var(--panel)]">
          <Plus size={13} /> New
        </button>
      </div>
    </div>
  );
}

function ObjectTree({ schema, activeTable, onSelect }: {
  schema: DbSchema | null; activeTable: string | null; onSelect: (name: string) => void;
}) {
  if (!schema) return <div className="overflow-auto p-3 text-[var(--faint)] text-xs">No database open.</div>;
  const tables = schema.tables.filter((t) => t.type === "table");
  const views = schema.tables.filter((t) => t.type === "view");
  const Section = ({ label, items, icon }: { label: string; items: DbTable[]; icon: React.ReactNode }) => (
    items.length > 0 && (
      <div className="mb-2">
        <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--faint)]">{label} ({items.length})</div>
        {items.map((t) => (
          <button key={t.name} onClick={() => onSelect(t.name)} title={t.ddl?.slice(0, 120)}
            className={"w-full flex items-center gap-2 px-3 py-1 text-left text-xs " + (t.name === activeTable ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--text)] hover:bg-[var(--hover)]")}>
            <span className="text-[var(--muted)]">{icon}</span>
            <span className="truncate flex-1">{t.name}</span>
            {t.rowCount >= 0 && <span className="mono text-[10px] text-[var(--faint)]">{t.rowCount}</span>}
          </button>
        ))}
      </div>
    )
  );
  return (
    <div className="overflow-auto border-r border-[var(--border)]">
      <Section label="Tables" items={tables} icon={<Table2 size={12} />} />
      <Section label="Views" items={views} icon={<Eye size={12} />} />
      {schema.indexes.length > 0 && (
        <div className="mb-2">
          <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--faint)]">Indexes ({schema.indexes.length})</div>
          {schema.indexes.map((i) => (
            <div key={i.name} className="flex items-center gap-2 px-3 py-1 text-xs text-[var(--muted)]">
              <span className="mono text-[10px]">idx</span><span className="truncate">{i.name}</span>
            </div>
          ))}
        </div>
      )}
      {schema.triggers.length > 0 && (
        <div className="mb-2">
          <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--faint)]">Triggers ({schema.triggers.length})</div>
          {schema.triggers.map((t) => (
            <div key={t.name} className="flex items-center gap-2 px-3 py-1 text-xs text-[var(--muted)]">
              <GitBranch size={12} /><span className="truncate">{t.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TypeChip({ type }: { type: string }) {
  if (!type) return null;
  return <span className="mono text-[9px] px-1 rounded bg-[var(--hover)] text-[var(--muted)]">{type}</span>;
}

function DataGrid({ columns, result }: { columns: string[]; result: QueryResult | null }) {
  const cols = result?.columns.length ? result.columns : columns;
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="overflow-auto flex-1">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-[var(--panel)] z-10">
            <tr>
              {cols.map((c) => (
                <th key={c} className="text-left font-semibold text-[var(--text)] px-2 py-1.5 border-b border-[var(--border)] whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result?.rows.map((row, i) => (
              <tr key={i} className="hover:bg-[var(--hover)]">
                {cols.map((c) => {
                  const v = (row as Record<string, unknown>)[c];
                  const isNull = v === null || v === undefined;
                  const isNum = typeof v === "number";
                  return (
                    <td key={c} className={"px-2 py-1 border-b border-[var(--border)] mono text-[var(--text)] align-top " + (isNum ? "text-right" : "")}>
                      {isNull ? <span className="italic text-[var(--faint)]">NULL</span> : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {result && result.rows.length === 0 && (
              <tr><td colSpan={cols.length} className="px-2 py-6 text-center text-[var(--faint)]">No rows.</td></tr>
            )}
            {!result && (
              <tr><td colSpan={cols.length} className="px-2 py-6 text-center text-[var(--faint)]">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {result && (
        <div className="px-3 py-1 border-t border-[var(--border)] text-[11px] text-[var(--faint)] mono">
          {result.rows.length} row{result.rows.length === 1 ? "" : "s"} · {result.ms}ms
        </div>
      )}
    </div>
  );
}

function StructurePane({ table }: { table: DbTable }) {
  return (
    <div className="flex-1 overflow-auto p-3 flex flex-col gap-3">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-[var(--faint)]">
            <th className="text-left font-semibold px-2 py-1 border-b border-[var(--border)]">#</th>
            <th className="text-left font-semibold px-2 py-1 border-b border-[var(--border)]">Name</th>
            <th className="text-left font-semibold px-2 py-1 border-b border-[var(--border)]">Type</th>
            <th className="text-left font-semibold px-2 py-1 border-b border-[var(--border)]">Notnull</th>
            <th className="text-left font-semibold px-2 py-1 border-b border-[var(--border)]">Key</th>
          </tr>
        </thead>
        <tbody>
          {table.columns.map((c: DbColumn, i) => (
            <tr key={c.name} className="hover:bg-[var(--hover)]">
              <td className="px-2 py-1 border-b border-[var(--border)] text-[var(--faint)] mono">{i}</td>
              <td className="px-2 py-1 border-b border-[var(--border)] mono text-[var(--text)]">{c.name}</td>
              <td className="px-2 py-1 border-b border-[var(--border)]"><TypeChip type={c.type} /></td>
              <td className="px-2 py-1 border-b border-[var(--border)] text-[var(--muted)]">{c.notNull ? "NOT NULL" : ""}</td>
              <td className="px-2 py-1 border-b border-[var(--border)] text-[var(--muted)]">
                {c.pk ? <span className="text-[var(--accent)]">PK</span> : ""}
                {c.fk ? <span className="ml-1 text-[var(--faint)]">→ {c.fk}</span> : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {table.ddl && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--faint)] mb-1">DDL</div>
          <pre className="mono text-[11px] text-[var(--text)] bg-[var(--bg)] border border-[var(--border)] rounded-md p-2 overflow-auto whitespace-pre-wrap">{table.ddl}</pre>
        </div>
      )}
    </div>
  );
}

function PragmasPane({ pragmas }: { pragmas: Record<string, string> }) {
  const entries = Object.entries(pragmas);
  if (!entries.length) return <EmptyHint text="No pragmas." />;
  return (
    <div className="flex-1 overflow-auto p-3">
      <table className="text-xs border-collapse">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="hover:bg-[var(--hover)]">
              <td className="px-2 py-1 border-b border-[var(--border)] mono text-[var(--muted)] whitespace-nowrap">{k}</td>
              <td className="px-2 py-1 border-b border-[var(--border)] mono text-[var(--text)]">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const WRITE_VERBS = new Set(["CREATE", "DROP", "ALTER", "INSERT", "UPDATE", "DELETE", "REPLACE", "ATTACH", "DETACH"]);

function SqlPane({ source, writable, onExeced }: { source: DbSource; writable: boolean; onExeced: () => void }) {
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [execResult, setExecResult] = useState<{ rowsAffected: number; ms: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true); setErr(null);
    const verb = sql.trim().split(/\s/, 1)[0]?.toUpperCase() ?? "";
    const isWrite = WRITE_VERBS.has(verb);
    if (isWrite && !writable) {
      setErr("Flip Read-only → Writable to run write statements.");
      setBusy(false);
      return;
    }
    try {
      if (isWrite) {
        const r = await dbApi.exec(source, sql);
        setExecResult(r); setResult(null);
        onExeced(); // reload schema so new tables/views appear
      } else {
        const r = await dbApi.query(source, sql, [], 1000);
        setResult(r); setExecResult(null);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const cols = result?.columns ?? [];
  return (
    <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
      <textarea value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false}
        placeholder={"SELECT * FROM users LIMIT 10"}
        className="flex-1 min-h-[120px] mono rounded-lg border border-[var(--border-2)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y" />
      <div className="flex items-center gap-2">
        <button onClick={run} disabled={busy || !sql.trim()}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-bold bg-[var(--accent)] text-[var(--panel)] disabled:opacity-40">
          <Play size={13} /> Run
        </button>
        {!writable && <span className="text-[11px] text-[var(--faint)]">Read-only — write statements need the Writable toggle.</span>}
      </div>
      {err && <Notice variant="error" layout="inline" className="text-xs px-2 py-1">{err}</Notice>}
      {execResult && <div className="text-[11px] mono text-[var(--muted)]">{execResult.rowsAffected} row(s) affected · {execResult.ms}ms</div>}
      {result && (
        <div className="overflow-auto border border-[var(--border)] rounded-md max-h-60">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-[var(--panel)]">
              <tr>{cols.map((c) => <th key={c} className="text-left mono font-semibold px-2 py-1 border-b border-[var(--border)] whitespace-nowrap">{c}</th>)}</tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="hover:bg-[var(--hover)]">
                  {cols.map((c) => {
                    const v = (row as Record<string, unknown>)[c];
                    return <td key={c} className="mono px-2 py-1 border-b border-[var(--border)]">{v === null || v === undefined ? <span className="italic text-[var(--faint)]">NULL</span> : String(v)}</td>;
                  })}
                </tr>
              ))}
              {result.rows.length === 0 && <tr><td colSpan={cols.length} className="px-2 py-4 text-center text-[var(--faint)]">No rows.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
