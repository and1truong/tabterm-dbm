import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const CLIENT = "dist/modules/dbm/client.js";
const SERVER = "dist/modules/dbm/server.js";

test("dbm server bundle exists + exports activate", async () => {
  expect(existsSync(SERVER)).toBe(true);
  const m = await import(`./${SERVER}`);
  expect(typeof (m.default ?? m.activate)).toBe("function");
});

test("dbm client bundle exists + exports activate", async () => {
  expect(existsSync(CLIENT)).toBe(true);
  const m = await import(`./${CLIENT}`);
  expect(typeof (m.default ?? m.activate)).toBe("function");
});

test("dbm client bundle imports only the host-provided bare specifiers", () => {
  const code = readFileSync(CLIENT, "utf8");
  const bare = [...code.matchAll(/(?:import|from)\s*["']([^."'/][^"']*)["']/g)]
    .map((m) => m[1])
    .map((s) => (s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0]));
  const allowed = new Set(["react", "react-dom", "zustand"]);
  const offenders = bare.filter((s) => !allowed.has(s) && s !== "react/jsx-runtime");
  expect(offenders).toEqual([]);
});
