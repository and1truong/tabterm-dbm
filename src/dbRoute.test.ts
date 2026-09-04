import { describe, expect, test } from "bun:test";
import { dbRoutePath, parseDbRoute, shouldBlockRouteChange, tableRequiredForPane } from "./dbRoute.ts";

describe("database module routes", () => {
  test("maps public URL sections to internal panes", () => {
    expect(parseDbRoute(["users"], ["users"])).toEqual({ table: "users", pane: "structure", modal: null });
    expect(parseDbRoute(["users", "data"]).pane).toBe("data");
    expect(parseDbRoute(["users", "query"]).pane).toBe("sql");
    expect(parseDbRoute(["users", "insight"]).pane).toBe("insights");
    expect(parseDbRoute(["users", "pragmas"]).pane).toBe("pragmas");
    expect(parseDbRoute(["users", "relationships"]).pane).toBe("diagram");
  });

  test("builds canonical paths, including schema-qualified table keys", () => {
    expect(dbRoutePath("public.users", "structure")).toEqual(["public.users"]);
    expect(dbRoutePath("public.users", "data")).toEqual(["public.users", "data"]);
    expect(dbRoutePath("public.users", "sql")).toEqual(["public.users", "query"]);
    expect(dbRoutePath("public.users", "insights")).toEqual(["public.users", "insight"]);
    expect(dbRoutePath("public.users", "diagram")).toEqual(["public.users", "relationships"]);
  });

  test("keeps database-wide panes reachable without a table", () => {
    expect(parseDbRoute(["query"], [])).toEqual({ table: null, pane: "sql", modal: null });
    expect(parseDbRoute(["pragmas"], [])).toEqual({ table: null, pane: "pragmas", modal: null });
    expect(dbRoutePath(null, "structure")).toEqual(["structure"]);
    expect(parseDbRoute(["structure"], [])).toEqual({ table: null, pane: "structure", modal: null });
    expect(dbRoutePath(null, "sql")).toEqual(["query"]);
    expect(dbRoutePath(null, "diagram")).toEqual(["relationships"]);
    expect(tableRequiredForPane("structure")).toBeTrue();
    expect(tableRequiredForPane("data")).toBeTrue();
    expect(tableRequiredForPane("sql")).toBeFalse();
  });

  test("gives database-wide actions an unambiguous namespace and preserves their pane", () => {
    expect(parseDbRoute(["actions", "new-view"])).toEqual({ table: null, pane: "data", modal: "new-view" });
    expect(parseDbRoute(["actions", "migration", "query"])).toEqual({ table: null, pane: "sql", modal: "migration" });
    expect(parseDbRoute(["actions", "migration", "data", "orders"])).toEqual({ table: "orders", pane: "data", modal: "migration" });
    expect(dbRoutePath(null, "data", "new-view")).toEqual(["actions", "new-view"]);
    expect(dbRoutePath(null, "sql", "migration")).toEqual(["actions", "migration", "query"]);
    expect(dbRoutePath("orders", "data", "migration")).toEqual(["actions", "migration", "data", "orders"]);
    expect(dbRoutePath(null, "structure", "migration")).toEqual(["actions", "migration", "structure"]);
  });

  test("does not reserve action or pane names when they are real tables", () => {
    expect(parseDbRoute(["migration"], ["migration"])).toEqual({ table: "migration", pane: "structure", modal: null });
    expect(parseDbRoute(["new-view", "data"], ["new-view"])).toEqual({ table: "new-view", pane: "data", modal: null });
    expect(parseDbRoute(["query"], ["query"])).toEqual({ table: "query", pane: "structure", modal: null });
  });

  test("blocks route changes while staged row changes are dirty", () => {
    expect(shouldBlockRouteChange(["users", "data"], ["users", "query"], true)).toBeTrue();
    expect(shouldBlockRouteChange(["users", "data"], ["users", "data"], true)).toBeFalse();
    expect(shouldBlockRouteChange(["users", "data"], ["users", "query"], false)).toBeFalse();
  });

  test("uses browse data while the database route has no selected table", () => {
    expect(parseDbRoute([])).toEqual({ table: null, pane: "data", modal: null });
  });
});
