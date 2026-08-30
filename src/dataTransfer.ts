import type { DbTable } from "../shared.ts";
import { tableSql } from "./sqlIdentifiers.ts";
import { unwrapDbValueForDisplay } from "../binaryValues.ts";

export type ExportFormat = "csv" | "json" | "sql" | "markdown";

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sqlValue(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

export function serializeRows(format: ExportFormat, columns: string[], rows: Record<string, unknown>[], table?: DbTable): string {
  const displayRows = rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([column, value]) => [column, unwrapDbValueForDisplay(value)]),
  ));
  if (format === "json") return JSON.stringify(displayRows, null, 2) + "\n";
  if (format === "markdown") {
    const cell = (value: unknown) => String(value ?? "NULL").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
    return `| ${columns.map(cell).join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |\n`
      + displayRows.map((row) => `| ${columns.map((column) => cell(row[column])).join(" | ")} |`).join("\n") + "\n";
  }
  if (format === "sql") {
    if (!table) throw new Error("SQL export requires a table");
    const names = columns.map((column) => `"${column.replace(/"/g, '""')}"`).join(", ");
    return displayRows.map((row) => `INSERT INTO ${tableSql(table)} (${names}) VALUES (${columns.map((column) => sqlValue(row[column])).join(", ")});`).join("\n") + "\n";
  }
  return [columns.map(csvCell).join(","), ...displayRows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
}

export function parseCsv(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; }
        else quoted = false;
      } else value += ch;
      continue;
    }
    if (ch === '"' && value === "") { quoted = true; continue; }
    if (ch === ",") { record.push(value); value = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(value); value = "";
      if (record.some((cell) => cell !== "")) records.push(record);
      record = [];
      continue;
    }
    value += ch;
  }
  record.push(value);
  if (record.some((cell) => cell !== "")) records.push(record);
  const columns = (records.shift() ?? []).map((column) => column.trim());
  if (!columns.length || columns.some((column) => !column)) throw new Error("CSV must have a non-empty header row");
  if (new Set(columns).size !== columns.length) throw new Error("CSV header names must be unique");
  const rows = records.map((cells, rowIndex) => {
    if (cells.length !== columns.length) throw new Error(`CSV row ${rowIndex + 2} has ${cells.length} values; expected ${columns.length}`);
    return Object.fromEntries(columns.map((column, index) => [column, cells[index]]));
  });
  return { columns, rows };
}
