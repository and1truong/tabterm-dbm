// Real-DOM smoke for connection policy, testing, and save/open behavior.
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });
for (const key of [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement",
  "HTMLSelectElement", "Element", "Node", "Text", "Event", "MouseEvent",
  "CustomEvent", "getComputedStyle",
] as const) {
  (globalThis as any)[key] = (win as any)[key];
}
(globalThis as any).window = win;

const requests: Array<{ path: string; body?: any }> = [];
(globalThis as any).fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const path = String(input);
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  requests.push({ path, body });
  if (path.endsWith("/connections") && !init?.method) return Response.json({ connections: [] });
  if (path.endsWith("/connections/test")) {
    return Response.json({ database: "app", user: "dbm", serverVersion: "17.2", ms: 8 });
  }
  if (path.endsWith("/connections") && init?.method === "POST") {
    return Response.json({
      id: "production-app", label: body.label, url: "postgres://db.example/app",
      environment: body.environment, readOnly: body.readOnly, createdAt: 1, lastUsedAt: null,
    });
  }
  if (path.endsWith("/create")) return Response.json({ path: body.path, created: true });
  return Response.json({ error: "unexpected smoke request" }, { status: 500 });
};

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

async function exercise(width: number) {
  Object.defineProperty(win, "innerWidth", { value: width, configurable: true });
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  const { DatabaseOpenModal } = await import("../src/DatabaseOpenModal.tsx");

  let opened: any = null;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(React.createElement(DatabaseOpenModal, {
    cwd: "/work", discovered: [], onClose: () => {}, onOpen: (source: any) => { opened = source; },
  })));
  await settle();

  const select = container.querySelector('[aria-label="Connection environment"]') as HTMLSelectElement | null;
  if (!select) fail(`${width}px: environment policy is missing`);
  setValue(select, "production");

  const allowWrites = [...container.querySelectorAll('input[type="checkbox"]')][0] as HTMLInputElement | undefined;
  if (!allowWrites) fail(`${width}px: write policy is missing`);
  allowWrites.click();

  const inputs = [...container.querySelectorAll("input")];
  const label = inputs.find((input) => input.getAttribute("placeholder") === "Label (optional)");
  const url = inputs.find((input) => input.getAttribute("placeholder")?.startsWith("postgres://"));
  if (!label || !url) fail(`${width}px: connection fields are missing`);
  setValue(label, "Production app");
  setValue(url, "postgres://dbm:secret@db.example/app");
  await settle();

  if (!container.textContent?.includes("Production writes are enabled")) fail(`${width}px: production warning is missing`);
  const testButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Test");
  testButton?.click();
  await settle();
  await settle();
  if (!container.textContent?.includes("Connected to app as dbm")) {
    fail(`${width}px: connection test result is missing (${JSON.stringify(requests)})`);
  }

  const connectButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Connect");
  connectButton?.click();
  await settle();
  await settle();
  if (opened?.environment !== "production" || opened?.readOnly !== false) fail(`${width}px: saved policy was not opened`);
  const save = requests.find((request) => request.path.endsWith("/connections") && request.body?.label === "Production app");
  if (save?.body?.url !== "postgres://dbm:secret@db.example/app") fail(`${width}px: credential was not submitted to the secure save endpoint`);

  flushSync(() => root.unmount());
  container.remove();

  let created: any = null;
  const createContainer = document.createElement("div");
  document.body.appendChild(createContainer);
  const createAppRoot = createRoot(createContainer);
  flushSync(() => createAppRoot.render(React.createElement(DatabaseOpenModal, {
    cwd: "/work", discovered: [], create: true, onClose: () => {}, onOpen: (source: any) => { created = source; },
  })));
  const pathInput = createContainer.querySelector('input[placeholder="/work/new.db"]') as HTMLInputElement | null;
  if (!pathInput) fail(`${width}px: SQLite create path is missing`);
  setValue(pathInput, "/work/new.sqlite");
  await settle();
  const createButton = [...createContainer.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Create");
  createButton?.click();
  await settle(); await settle();
  if (created?.path !== "/work/new.sqlite") fail(`${width}px: SQLite create endpoint did not open the new database`);
  flushSync(() => createAppRoot.unmount());
  createContainer.remove();
}

await exercise(1280);
await exercise(480);
console.log("PASS: connection test/policy/save flow works at 1280px and 480px");
