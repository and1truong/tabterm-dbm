export type DbPane = "structure" | "data" | "sql" | "diagram" | "insights" | "pragmas";
export type DbModal = "new-view" | "migration";

export interface DbRoute {
  table: string | null;
  pane: DbPane;
  modal: DbModal | null;
}

const ACTION_SEGMENT = "actions";

const segmentToPane: Record<string, DbPane> = {
  data: "data",
  query: "sql",
  relationships: "diagram",
  insight: "insights",
  pragmas: "pragmas",
};

const paneToSegment: Partial<Record<DbPane, string>> = {
  data: "data",
  sql: "query",
  diagram: "relationships",
  insights: "insight",
  pragmas: "pragmas",
};

export function parseDbRoute(path: readonly string[], knownTables?: readonly string[]): DbRoute {
  const table = path[0] ?? null;
  if (!table) return { table: null, pane: "data", modal: null };

  const section = path[1];
  if (table === ACTION_SEGMENT && (section === "new-view" || section === "migration")) {
    return { table: null, pane: "data", modal: section };
  }

  // A one-segment pane route keeps database-wide tools reachable when a schema
  // has no tables. A real table with the same name wins once the schema is known.
  const databasePane = segmentToPane[table];
  if (!section && databasePane && !knownTables?.includes(table)) {
    return { table: null, pane: databasePane, modal: null };
  }

  return { table, pane: section ? (segmentToPane[section] ?? "structure") : "structure", modal: null };
}

export function dbRoutePath(table: string | null, pane: DbPane, modal: DbModal | null = null): string[] {
  if (modal) return [ACTION_SEGMENT, modal];
  const section = paneToSegment[pane];
  if (!table) return section && pane !== "data" ? [section] : [];
  return section ? [table, section] : [table];
}

export function sameRoutePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

export function tableRequiredForPane(pane: DbPane): boolean {
  return pane === "structure" || pane === "data";
}

export function shouldBlockRouteChange(current: readonly string[], next: readonly string[], dataDirty: boolean): boolean {
  return dataDirty && !sameRoutePath(current, next);
}
