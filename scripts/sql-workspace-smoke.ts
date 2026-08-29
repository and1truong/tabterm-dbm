// Real-DOM smoke for CodeMirror console tabs, execution, results, and history.
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });
for (const key of [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement",
  "Element", "Node", "Text", "Event", "KeyboardEvent", "MouseEvent",
  "CustomEvent", "MutationObserver", "DOMRect", "getComputedStyle",
] as const) (globalThis as any)[key] = (win as any)[key];
(globalThis as any).window = win;
(globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0);
(globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
Object.defineProperty(win, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });

(globalThis as any).fetch = async (input: string | URL | Request) => {
  const url = String(input);
  if (url.endsWith("/query")) return Response.json({ columns: ["answer"], rows: [{ answer: 1 }], ms: 1, hasMore: false, offset: 0 });
  if (url.endsWith("/explain")) return Response.json({ columns: ["detail"], rows: [{ detail: "SCAN constant row" }], ms: 1, hasMore: false, offset: 0 });
  return Response.json({ error: "unexpected smoke request" }, { status: 500 });
};

function fail(message: string): never { console.error(`FAIL: ${message}`); process.exit(1); }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function exercise(width: number) {
  Object.defineProperty(win, "innerWidth", { value: width, configurable: true });
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  const { SqlWorkspace } = await import("../src/SqlWorkspace.tsx");

  const saved = {
    tabs: [{ id: "console-1", name: "Console 1", sql: "SELECT 1 AS answer;" }],
    activeId: "console-1",
    history: [],
  };
  const writes: unknown[] = [];
  const host = {
    kv: { get: () => saved, set: (_key: string, value: unknown) => writes.push(value), subscribe: () => () => {} },
    context: { select: (selector: any) => selector({ theme: { mode: "dark" } }) },
  } as any;
  const schema = {
    tables: [{
      name: "users", type: "table", rowCount: -1, ddl: "",
      columns: [{ name: "id", type: "integer", notNull: true, pk: true, fk: null }],
    }],
    indexes: [], triggers: [], pragmas: {},
  } as any;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(React.createElement(SqlWorkspace, {
    host, source: { kind: "sqlite", path: "/tmp/smoke.sqlite" }, schema,
    writable: false, onExeced: () => {},
  })));
  await settle();

  if (!container.querySelector(".cm-editor")) fail(`${width}px: CodeMirror did not mount`);
  const run = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Run");
  if (!run) fail(`${width}px: Run control is missing`);
  run.click();
  await settle(); await settle();
  if (!container.textContent?.includes("answer") || !container.textContent?.includes("1 rows")) fail(`${width}px: query result did not render`);

  const explain = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Explain");
  explain?.click();
  await settle(); await settle();
  if (!container.textContent?.includes("Plan") || !container.textContent?.includes("SCAN constant row")) fail(`${width}px: explain plan did not render`);

  const add = container.querySelector('[aria-label="New SQL console"]') as HTMLElement | null;
  add?.click();
  await settle();
  if (!container.textContent?.includes("Console 2")) fail(`${width}px: second console did not open`);
  if (!writes.length) fail(`${width}px: console state was not persisted`);

  const history = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "History");
  history?.click();
  await settle();
  if (!container.textContent?.includes("Query history") || !container.textContent?.includes("SELECT 1 AS answer")) fail(`${width}px: query history did not render`);

  flushSync(() => root.unmount());
  container.remove();
}

await exercise(1280);
await exercise(480);
console.log("PASS: SQL workspace consoles/results/history work at 1280px and 480px");
