import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { PostgreSQL, SQLite, sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import type { ClientHost } from "@tabterm/module-host/client";
import type { DbSchema, ExecResult, QueryResult } from "../shared.ts";
import { dbApi } from "./dbApi.ts";
import type { DbSource } from "./dbApi.ts";
import { isWriteSql, sqlToRun } from "./sqlConsole.ts";
import Notice from "./Notice.tsx";

interface ConsoleTab { id: string; name: string; sql: string }
interface HistoryEntry { id: string; sql: string; ranAt: number; ms: number; ok: boolean }
interface SavedWorkspace { tabs: ConsoleTab[]; activeId: string; history: HistoryEntry[] }
interface StatementOutput { sql: string; kind?: "query" | "explain"; result?: QueryResult; exec?: ExecResult; error?: string }

function freshWorkspace(): SavedWorkspace {
  const id = crypto.randomUUID();
  return { tabs: [{ id, name: "Console 1", sql: "" }], activeId: id, history: [] };
}

function isSavedWorkspace(value: unknown): value is SavedWorkspace {
  if (!value || typeof value !== "object") return false;
  const saved = value as Partial<SavedWorkspace>;
  return Array.isArray(saved.tabs) && saved.tabs.length > 0 && typeof saved.activeId === "string" && Array.isArray(saved.history);
}

function sourceKey(source: DbSource): string {
  return source.kind === "sqlite" ? `sqlite:${source.path}` : `postgres:${source.connId}`;
}

export function SqlWorkspace({ host, source, schema, writable, onExeced }: {
  host: ClientHost;
  source: DbSource;
  schema: DbSchema;
  writable: boolean;
  onExeced: () => void;
}) {
  const storageKey = `sql-workspace:${sourceKey(source)}`;
  const [workspace, setWorkspace] = useState<SavedWorkspace>(() => {
    const saved = host.kv.get(storageKey);
    return isSavedWorkspace(saved) ? saved : freshWorkspace();
  });
  const [outputs, setOutputs] = useState<StatementOutput[]>([]);
  const [activeOutput, setActiveOutput] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editor = useRef<any>(null);
  const controller = useRef<AbortController | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mode = host.context.select((state) => state.theme.mode);

  useEffect(() => host.kv.subscribe(storageKey, (value) => {
    if (isSavedWorkspace(value)) setWorkspace(value);
  }), [host, storageKey]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const persist = (next: SavedWorkspace) => {
    setWorkspace(next);
    host.kv.set(storageKey, next);
  };
  const active = workspace.tabs.find((tab) => tab.id === workspace.activeId) ?? workspace.tabs[0];
  const updateSql = (value: string) => {
    const next = {
      ...workspace,
      tabs: workspace.tabs.map((tab) => tab.id === active.id ? { ...tab, sql: value } : tab),
    };
    setWorkspace(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => host.kv.set(storageKey, next), 500);
  };
  const completionSchema = useMemo(() => Object.fromEntries(schema.tables.map((table) => [
    table.schema ? `${table.schema}.${table.name}` : table.name,
    table.columns.map((column) => column.name),
  ])), [schema]);
  const extensions = useMemo(() => [sql({
    dialect: source.kind === "postgres" ? PostgreSQL : SQLite,
    schema: completionSchema,
  })], [source.kind, completionSchema]);

  const addConsole = () => {
    const id = crypto.randomUUID();
    const tab = { id, name: `Console ${workspace.tabs.length + 1}`, sql: "" };
    persist({ ...workspace, tabs: [...workspace.tabs, tab], activeId: id });
  };
  const closeConsole = (id: string) => {
    if (workspace.tabs.length === 1) return;
    const tabs = workspace.tabs.filter((tab) => tab.id !== id);
    persist({ ...workspace, tabs, activeId: workspace.activeId === id ? tabs[0].id : workspace.activeId });
  };

  const run = async (all: boolean) => {
    const view = editor.current;
    const selection = view?.state.selection.main ?? { from: 0, to: 0 };
    const statements = sqlToRun(active.sql, selection, all);
    if (!statements.length) return;
    setBusy(true); setError(null); setOutputs([]); setActiveOutput(0);
    const nextOutputs: StatementOutput[] = [];
    let nextWorkspace = workspace;
    let wrote = false;
    for (const statement of statements) {
      const started = performance.now();
      const isWrite = isWriteSql(statement);
      if (isWrite && !writable) {
        nextOutputs.push({ sql: statement, error: "Read-only mode: enable Writable before running this statement." });
        break;
      }
      try {
        let output: StatementOutput;
        if (isWrite) {
          output = { sql: statement, exec: await dbApi.exec(source, statement, true) };
          wrote = true;
        } else {
          const abort = new AbortController();
          controller.current = abort;
          output = { sql: statement, result: await dbApi.query(source, statement, [], 1000, 0, abort.signal) };
        }
        nextOutputs.push(output);
        const entry: HistoryEntry = {
          id: crypto.randomUUID(), sql: statement, ranAt: Date.now(),
          ms: output.result?.ms ?? output.exec?.ms ?? performance.now() - started, ok: true,
        };
        nextWorkspace = { ...nextWorkspace, history: [entry, ...nextWorkspace.history].slice(0, 100) };
        persist(nextWorkspace);
      } catch (runError) {
        const message = controller.current?.signal.aborted ? "Query cancelled." : String(runError);
        nextOutputs.push({ sql: statement, error: message });
        const entry: HistoryEntry = { id: crypto.randomUUID(), sql: statement, ranAt: Date.now(), ms: performance.now() - started, ok: false };
        nextWorkspace = { ...nextWorkspace, history: [entry, ...nextWorkspace.history].slice(0, 100) };
        persist(nextWorkspace);
        break;
      } finally { controller.current = null; }
      setOutputs([...nextOutputs]);
    }
    setOutputs([...nextOutputs]);
    if (wrote) onExeced();
    setBusy(false);
  };

  const explain = async () => {
    const selection = editor.current?.state.selection.main ?? { from: 0, to: 0 };
    const statement = sqlToRun(active.sql, selection, false)[0];
    if (!statement) return;
    if (isWriteSql(statement)) {
      setOutputs([{ sql: statement, kind: "explain", error: "EXPLAIN is available only for read queries." }]);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setOutputs([]); setActiveOutput(0);
    try {
      setOutputs([{ sql: statement, kind: "explain", result: await dbApi.explain(source, statement, [], abort.signal) }]);
    } catch (runError) {
      setOutputs([{ sql: statement, kind: "explain", error: abort.signal.aborted ? "Query cancelled." : String(runError) }]);
    } finally { controller.current = null; setBusy(false); }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col" onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void run(event.shiftKey);
      }
    }}>
      <div className="flex items-center gap-1 px-2 pt-1.5 border-b border-[var(--border)] bg-[var(--bg)] overflow-x-auto">
        {workspace.tabs.map((tab) => (
          <button key={tab.id} onClick={() => persist({ ...workspace, activeId: tab.id })}
            className={"group flex items-center gap-2 px-2.5 py-1.5 rounded-t-md text-xs whitespace-nowrap " + (tab.id === active.id ? "bg-[var(--panel)] text-[var(--text)] border border-[var(--border)] border-b-0" : "text-[var(--muted)]")}>
            {tab.name}
            {workspace.tabs.length > 1 && <span role="button" aria-label={`Close ${tab.name}`} onClick={(event) => { event.stopPropagation(); closeConsole(tab.id); }}>×</span>}
          </button>
        ))}
        <button aria-label="New SQL console" onClick={addConsole} className="px-2 py-1 text-[var(--accent)]">＋</button>
        <button onClick={() => setHistoryOpen((open) => !open)} className="ml-auto px-2 py-1 text-[11px] font-semibold text-[var(--muted)]">History</button>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="min-h-[180px] flex-1 overflow-auto border-b border-[var(--border)]">
            <CodeMirror value={active.sql} height="100%" minHeight="180px" extensions={extensions}
              theme={mode === "dark" ? oneDark : "light"} basicSetup={{ autocompletion: true, lineNumbers: true, foldGutter: true }}
              placeholder="Write SQL…  ⌘/Ctrl+Enter runs selection or current statement"
              onCreateEditor={(view) => { editor.current = view; }} onChange={updateSql} />
          </div>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg)]">
            <button onClick={() => void run(false)} disabled={busy || !active.sql.trim()}
              className="px-3 py-1.5 rounded-md text-xs font-bold bg-[var(--accent)] text-[var(--panel)] disabled:opacity-40">Run</button>
            <button onClick={() => void run(true)} disabled={busy || !active.sql.trim()}
              className="px-3 py-1.5 rounded-md text-xs font-semibold border border-[var(--border-2)] text-[var(--muted)] disabled:opacity-40">Run all</button>
            <button onClick={() => void explain()} disabled={busy || !active.sql.trim()}
              className="px-3 py-1.5 rounded-md text-xs font-semibold border border-[var(--border-2)] text-[var(--muted)] disabled:opacity-40">Explain</button>
            {busy && controller.current && <button onClick={() => controller.current?.abort()} className="px-3 py-1.5 rounded-md text-xs font-semibold text-[var(--red)]">Cancel</button>}
            <span className="text-[10px] text-[var(--faint)]">⌘/Ctrl+Enter · Shift adds Run all</span>
          </div>
          {error && <Notice variant="error" layout="inline" className="px-3 py-1 text-xs">{error}</Notice>}
          <SqlOutputs outputs={outputs} active={activeOutput} onActive={setActiveOutput} />
        </div>

        {historyOpen && (
          <aside className="w-64 max-w-[40%] border-l border-[var(--border)] flex flex-col bg-[var(--bg)]">
            <div className="flex items-center px-3 py-2 border-b border-[var(--border)] text-xs font-bold text-[var(--text)]">
              Query history
              <button onClick={() => persist({ ...workspace, history: [] })} className="ml-auto text-[10px] text-[var(--muted)]">Clear</button>
            </div>
            <div className="overflow-auto">
              {workspace.history.map((entry) => (
                <button key={entry.id} onClick={() => updateSql(entry.sql)} className="w-full text-left px-3 py-2 border-b border-[var(--border)] hover:bg-[var(--hover)]">
                  <div className="mono text-[11px] truncate text-[var(--text)]">{entry.sql}</div>
                  <div className={"text-[10px] " + (entry.ok ? "text-[var(--faint)]" : "text-[var(--red)]")}>{new Date(entry.ranAt).toLocaleString()} · {Math.round(entry.ms)}ms</div>
                </button>
              ))}
              {!workspace.history.length && <div className="p-3 text-xs text-[var(--faint)]">No queries yet.</div>}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function SqlOutputs({ outputs, active, onActive }: { outputs: StatementOutput[]; active: number; onActive: (index: number) => void }) {
  if (!outputs.length) return <div className="h-40 grid place-items-center text-xs text-[var(--faint)]">Run a statement to see results.</div>;
  const output = outputs[active] ?? outputs[0];
  return (
    <div className="h-64 min-h-40 flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--border)] bg-[var(--bg)] overflow-x-auto">
        {outputs.map((item, index) => (
          <button key={index} onClick={() => onActive(index)} className={"px-2 py-1 rounded text-[11px] " + (index === active ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--muted)]")}>
            {item.kind === "explain" ? "Plan" : `Result ${index + 1}`}{item.error ? " · error" : ""}
          </button>
        ))}
      </div>
      {output.error ? <Notice variant="error" layout="inline" className="p-3 text-xs">{output.error}</Notice>
        : output.exec ? <div className="p-3 mono text-xs text-[var(--muted)]">{output.exec.rowsAffected} row(s) affected · {output.exec.ms}ms</div>
        : output.result ? <ResultTable result={output.result} /> : null}
    </div>
  );
}

function ResultTable({ result }: { result: QueryResult }) {
  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 bg-[var(--panel)]"><tr>{result.columns.map((column) => <th key={column} className="text-left mono px-2 py-1 border-b border-[var(--border)]">{column}</th>)}</tr></thead>
        <tbody>{result.rows.map((row, index) => <tr key={index}>{result.columns.map((column) => <td key={column} className="mono px-2 py-1 border-b border-[var(--border)]">{row[column] == null ? <i className="text-[var(--faint)]">NULL</i> : String(row[column])}</td>)}</tr>)}</tbody>
      </table>
      <div className="px-3 py-1 mono text-[10px] text-[var(--faint)]">{result.rows.length}{result.hasMore ? "+" : ""} rows · {result.ms}ms</div>
    </div>
  );
}
