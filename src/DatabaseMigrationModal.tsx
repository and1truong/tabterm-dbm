import { useState } from "react";
import type { MigrationResult } from "../shared.ts";
import type { DbSource } from "./dbApi.ts";
import { dbApi } from "./dbApi.ts";
import Notice from "./Notice.tsx";

export function DatabaseMigrationModal({ source, onClose, onApplied }: {
  source: DbSource;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [sql, setSql] = useState("");
  const [preview, setPreview] = useState<MigrationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validate = async () => {
    setBusy(true); setError(null); setPreview(null);
    try { setPreview(await dbApi.migration.preview(source, sql)); }
    catch (validateError) { setError(String(validateError)); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true); setError(null);
    try {
      await dbApi.migration.apply(source, sql);
      onApplied(); onClose();
    } catch (applyError) { setError(String(applyError)); }
    finally { setBusy(false); }
  };
  const production = source.kind === "postgres" && source.environment === "production";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div role="dialog" aria-label="Migration studio" className="w-[760px] max-w-[calc(100vw-2rem)] max-h-[88vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
          <div><div className="text-sm font-bold text-[var(--text)]">Migration Studio</div><div className="text-[10px] text-[var(--faint)]">Dry-run with rollback, then apply in one transaction</div></div>
          <button aria-label="Close migration studio" disabled={busy} onClick={onClose} className="ml-auto text-[var(--muted)]">×</button>
        </div>
        <div className="overflow-auto p-4 grid gap-3">
          {production && <Notice variant="warning" layout="inline" className="px-2 py-1 text-xs">This migration targets a production profile.</Notice>}
          <textarea aria-label="Migration SQL" value={sql} onChange={(event) => { setSql(event.target.value); setPreview(null); setError(null); }}
            spellCheck={false} placeholder={'CREATE TABLE example (\n  id INTEGER PRIMARY KEY\n);'}
            className="mono h-72 resize-y rounded-md border border-[var(--border-2)] bg-[var(--bg)] p-3 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]" />
          {preview && <Notice variant="success" layout="inline" className="px-2 py-1 text-xs">Dry-run passed and rolled back in {preview.ms}ms. The script is ready to apply.</Notice>}
          {error && <Notice variant="error" layout="inline" className="px-2 py-1 text-xs">{error}</Notice>}
          <div className="text-[10px] text-[var(--faint)]">BEGIN/COMMIT/ROLLBACK are managed by the runner. Changing the SQL invalidates the dry-run.</div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
          <button onClick={onClose} disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-[var(--muted)]">Cancel</button>
          <button onClick={() => void validate()} disabled={busy || !sql.trim()} className="px-3 py-1.5 rounded-md border border-[var(--border-2)] text-xs font-semibold text-[var(--muted)] disabled:opacity-40">{busy && !preview ? "Validating…" : "Dry run"}</button>
          <button onClick={() => void apply()} disabled={busy || !preview} className="px-3 py-1.5 rounded-md bg-[var(--red)] text-white text-xs font-bold disabled:opacity-40">Apply migration</button>
        </div>
      </div>
    </div>
  );
}
