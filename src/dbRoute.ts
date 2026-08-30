export type DbPane = "structure" | "data" | "sql" | "diagram" | "insights" | "pragmas";
export type DbModal = "new-view" | "migration";

export interface DbRoute {
  table: string | null;
  pane: DbPane;
  modal: DbModal | null;
}

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

export function parseDbRoute(path: readonly string[]): DbRoute {
  const table = path[0] ?? null;
  if (!table) return { table: null, pane: "data", modal: null };
  if (table === "new-view" || table === "migration") {
    return { table: null, pane: "data", modal: table };
  }

  const section = path[1];
  if (section === "new-view" || section === "migration") {
    return { table, pane: "structure", modal: section };
  }
  return { table, pane: section ? (segmentToPane[section] ?? "structure") : "structure", modal: null };
}

export function dbRoutePath(table: string | null, pane: DbPane, modal: DbModal | null = null): string[] {
  if (modal) return table ? [table, modal] : [modal];
  if (!table) return [];
  const section = paneToSegment[pane];
  return section ? [table, section] : [table];
}

export function sameRoutePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}
