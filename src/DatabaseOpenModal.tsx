import { useEffect, useState } from "react";
import { Database as DbIcon, X, Plug, Trash2 } from "lucide-react";
import Notice from "./Notice.tsx";
import type { DbFile, PgConnection } from "../shared.ts";
import { dbApi } from "./dbApi.ts";
import type { DbSource } from "./dbApi.ts";

export function DatabaseOpenModal({ cwd, discovered, onClose, onOpen, create }: {
  cwd: string; discovered: DbFile[]; onClose: () => void; onOpen: (src: DbSource) => void; create?: boolean;
}) {
  const [path, setPath] = useState("");
  const [pgUrl, setPgUrl] = useState("");
  const [pgLabel, setPgLabel] = useState("");
  const [saved, setSaved] = useState<PgConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Saved Postgres connections are irrelevant to the "create database" flow.
  useEffect(() => {
    if (create) return;
    dbApi.connections.list().then((r) => setSaved(r.connections)).catch(() => { /* none yet */ });
  }, [create]);

  const connect = async () => {
    const url = pgUrl.trim();
    if (!url) return;
    setBusy(true); setErr(null);
    try {
      const c = await dbApi.connections.save(pgLabel.trim() || url, url);
      onOpen({ kind: "postgres", connId: c.id, label: c.label, url: c.url });
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  };
  const openSaved = (c: PgConnection) => onOpen({ kind: "postgres", connId: c.id, label: c.label, url: c.url });
  const deleteSaved = async (id: string) => {
    try { await dbApi.connections.delete(id); setSaved((s) => s.filter((c) => c.id !== id)); }
    catch (e) { setErr(String(e)); }
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-[var(--border)]">
          <DbIcon size={15} className="text-[var(--muted)]" />
          <span className="text-sm font-semibold text-[var(--text)] flex-1">{create ? "Create database" : "Open database"}</span>
          <button onClick={onClose} className="w-7 h-7 grid place-items-center rounded-md hover:bg-[var(--hover)] text-[var(--muted)]"><X size={15} /></button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-auto">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">{create ? "New SQLite file" : "SQLite file"}</div>
          <input
            autoFocus value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false}
            placeholder={`${cwd}/new.db`}
            className="w-full mono rounded-lg border border-[var(--border-2)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          {!create && (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">Found in workspace</div>
              <div className="flex flex-col gap-0.5">
                {discovered.map((d) => (
                  <button key={d.path} onClick={() => onOpen({ kind: "sqlite", path: d.path })}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--hover)]">
                    <DbIcon size={14} className="text-[var(--accent-soft)]" />
                    <span className="mono text-xs text-[var(--text)] truncate flex-1">{d.path.replace(cwd + "/", "")}</span>
                    <span className="mono text-[11px] text-[var(--faint)]">{Math.round(d.sizeBytes / 1024)} KB</span>
                  </button>
                ))}
              </div>

              <div className="h-px bg-[var(--border)] my-1" />

              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">Connect to Postgres</div>
              <input
                value={pgLabel} onChange={(e) => setPgLabel(e.target.value)} spellCheck={false}
                placeholder="Label (optional)"
                className="w-full rounded-lg border border-[var(--border-2)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              <div className="flex gap-2">
                <input
                  value={pgUrl} onChange={(e) => setPgUrl(e.target.value)} spellCheck={false}
                  onKeyDown={(e) => { if (e.key === "Enter") void connect(); }}
                  placeholder="postgres://user:pass@host:5432/db"
                  className="flex-1 mono rounded-lg border border-[var(--border-2)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <button onClick={connect} disabled={busy || !pgUrl.trim()}
                  className="flex items-center gap-1.5 px-3 rounded-lg text-sm font-bold bg-[var(--accent)] text-[var(--panel)] disabled:opacity-40">
                  <Plug size={14} /> Connect
                </button>
              </div>

              {saved.length > 0 && (
                <>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--faint)]">Saved connections</div>
                  <div className="flex flex-col gap-0.5">
                    {saved.map((c) => (
                      <div key={c.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--hover)]">
                        <button onClick={() => openSaved(c)} className="flex items-center gap-2 text-left flex-1 min-w-0">
                          <DbIcon size={14} className="text-[var(--accent-soft)]" />
                          <span className="text-xs text-[var(--text)] truncate">{c.label}</span>
                          <span className="mono text-[11px] text-[var(--faint)] truncate">{c.url}</span>
                        </button>
                        <button onClick={() => void deleteSaved(c.id)} title="Forget connection"
                          className="w-6 h-6 grid place-items-center rounded-md text-[var(--muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg)] hover:text-[var(--red)]">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {err && <Notice variant="error" layout="inline" className="text-xs px-2 py-1">{err}</Notice>}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm font-semibold text-[var(--muted)] border border-[var(--border-2)] hover:bg-[var(--hover)]">Cancel</button>
          <button onClick={() => path.trim() && onOpen({ kind: "sqlite", path: path.trim() })}
            className="px-4 py-1.5 rounded-lg text-sm font-bold bg-[var(--accent)] text-[var(--panel)]">
            {create ? "Create" : "Open"}
          </button>
        </div>
      </div>
    </div>
  );
}
