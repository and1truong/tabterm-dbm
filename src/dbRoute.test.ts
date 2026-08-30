import { describe, expect, test } from "bun:test";
import { dbRoutePath, parseDbRoute } from "./dbRoute.ts";

describe("database module routes", () => {
  test("maps public URL sections to internal panes", () => {
    expect(parseDbRoute(["users"])).toEqual({ table: "users", pane: "structure", modal: null });
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

  test("gives database-wide create-view and migration modals addressable routes", () => {
    expect(parseDbRoute(["new-view"])).toEqual({ table: null, pane: "data", modal: "new-view" });
    expect(parseDbRoute(["migration"])).toEqual({ table: null, pane: "data", modal: "migration" });
    expect(dbRoutePath(null, "data", "new-view")).toEqual(["new-view"]);
    expect(dbRoutePath(null, "data", "migration")).toEqual(["migration"]);
  });

  test("also accepts table-scoped action links", () => {
    expect(parseDbRoute(["users", "new-view"]).modal).toBe("new-view");
    expect(parseDbRoute(["users", "migration"]).modal).toBe("migration");
  });

  test("uses browse data while the database route has no selected table", () => {
    expect(parseDbRoute([])).toEqual({ table: null, pane: "data", modal: null });
  });
});
