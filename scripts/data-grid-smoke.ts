// Real-DOM interaction smoke for the professional data-grid controls.
// Keep this as a standalone script: it must install happy-dom globals before
// react-dom is imported. Run with `bun scripts/data-grid-smoke.ts`.
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });
for (const key of [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement",
  "HTMLSelectElement", "Element", "Node", "Text", "Event", "MouseEvent",
  "CustomEvent", "Blob", "getComputedStyle",
] as const) {
  (globalThis as any)[key] = (win as any)[key];
}
(globalThis as any).window = win;

let clipboard = "";
Object.defineProperty((globalThis as any).navigator, "clipboard", {
  value: { writeText: async (value: string) => { clipboard = value; } },
  configurable: true,
});
let holdPreview = false;
const previewResolvers: (() => void)[] = [];
const flushPreview = () => { holdPreview = false; previewResolvers.splice(0).forEach((resolve) => resolve()); };
let lastApplyBody: { changes?: unknown[] } | null = null;
(globalThis as any).fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/rows/preview")) {
    const respond = () => Response.json({ statements: [{ kind: "update", sql: `UPDATE "users" SET "name" = ? WHERE "id" IS ?`, params: ["Augusta", 1] }] });
    if (holdPreview) return new Promise<Response>((resolve) => previewResolvers.push(() => resolve(respond())));
    return respond();
  }
  if (url.endsWith("/rows/apply")) {
    lastApplyBody = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    return Response.json({ applied: 1, rowsAffected: 1, ms: 1 });
  }
  return Response.json({ error: "unexpected smoke request" }, { status: 500 });
};

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function setValue(element: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor((globalThis as any).HTMLTextAreaElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}
function setInput(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor((globalThis as any).HTMLInputElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function exercise(width: number) {
  Object.defineProperty(win, "innerWidth", { value: width, configurable: true });
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  const { DataGrid } = await import("../src/WorkspaceDatabaseView.tsx");

  const events: string[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const baseResult = {
    columns: ["id", "name", "computed", "misc"],
    rows: [
      { id: 1, name: "Ada", computed: 2, misc: 42 },
      { id: 2, name: "G".repeat(200), computed: 4, misc: 7 },
      { id: 3, name: { __tabtermDbmWire: { kind: "binary", base64: "AA==" } }, computed: 6, misc: 8 },
      { id: 4, name: { ok: true }, computed: 8, misc: 9 },
    ],
    ms: 1.2,
    hasMore: true,
    offset: 0,
  };
  const gridProps = {
    table: {
      name: "users", type: "table", rowCount: -1, ddl: "",
      columns: [
        { name: "id", type: "integer", notNull: true, pk: true, fk: null },
        { name: "name", type: "text", notNull: true, pk: false, fk: null },
        { name: "computed", type: "integer", notNull: true, pk: false, fk: null, generated: true },
        { name: "seq", type: "integer", notNull: true, pk: false, fk: null, identity: true },
        { name: "misc", type: "", notNull: false, pk: false, fk: null },
      ],
    },
    source: { kind: "sqlite", path: "/tmp/smoke.sqlite" },
    writable: true,
    columns: ["id", "name", "computed", "seq", "misc"],
    sorts: [],
    pageSize: 100,
    onSort: (column: string, additive: boolean) => events.push(`sort:${column}:${additive}`),
    onPrevious: () => events.push("previous"),
    onNext: () => events.push("next"),
    onPageSize: (size: number) => events.push(`size:${size}`),
    onDirtyChange: (dirty: boolean) => events.push(`dirty:${dirty}`),
    onApplied: () => events.push("applied"),
    onExportAll: async () => ({ columns: ["id", "name", "computed"], rows: [{ id: 1, name: "Ada", computed: 2 }, { id: 2, name: "Grace", computed: 4 }] }),
  };
  const render = (result: typeof baseResult) =>
    flushSync(() => root.render(React.createElement(DataGrid, { ...gridProps, result })));
  render(baseResult);

  const byLabel = (label: string) => container.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
  const sort = byLabel("Sort by name");
  if (!sort) fail(`${width}px: sort control is not visible`);
  sort.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));

  const row = byLabel("Select row 1") as HTMLInputElement | null;
  if (!row) fail(`${width}px: row selection is not visible`);
  row.click();
  await settle();

  const copy = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Copy CSV");
  if (!copy) fail(`${width}px: copy control is not visible`);
  copy.click();
  await settle();
  if (clipboard !== "id,name,computed,misc\n1,Ada,2,42") fail(`${width}px: selected-row CSV was ${JSON.stringify(clipboard)}`);

  const next = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Next");
  if (!next || next.hasAttribute("disabled")) fail(`${width}px: next page is not available`);
  next.click();

  const pageSize = byLabel("Rows per page") as HTMLSelectElement | null;
  if (!pageSize) fail(`${width}px: page-size selector is not visible`);
  pageSize.value = "50";
  pageSize.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();

  if (!events.includes("sort:name:true")) fail(`${width}px: shift-sort interaction did not fire`);
  if (!events.includes("next")) fail(`${width}px: next-page interaction did not fire`);
  if (!events.includes("size:50")) fail(`${width}px: page-size interaction did not fire`);
  if (!container.textContent?.includes("1–4+")) fail(`${width}px: result range is missing`);

  const columnsButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Columns 4/4");
  columnsButton?.click();
  await settle();
  if (!container.querySelectorAll('input[type="checkbox"]').length) fail(`${width}px: column chooser is missing`);
  columnsButton?.click();
  const largeValue = container.querySelector('button[title="Open large value"]') as HTMLElement | null;
  largeValue?.click();
  await settle();
  if (!container.querySelector('[role="dialog"][aria-label="Large value inspector"]')) fail(`${width}px: large-value inspector is missing`);
  byLabel("Close large value")?.click();

  const binaryCell = [...container.querySelectorAll("td")].find((cell) => cell.textContent?.trim() === "<binary 1 bytes>");
  if (!binaryCell) fail(`${width}px: binary cell is missing`);
  binaryCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
  if (byLabel("Edit row 3 name")) fail(`${width}px: binary cell incorrectly opened the text editor`);

  const objectCell = [...container.querySelectorAll("td")].find((cell) => cell.textContent?.trim() === '{"ok":true}');
  if (!objectCell) fail(`${width}px: object-valued cell is missing`);
  objectCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
  if (byLabel("Edit row 4 name")) fail(`${width}px: object-valued cell incorrectly opened the text editor`);

  const generatedCell = container.querySelectorAll("tbody tr")[0]?.querySelectorAll("td")[4] as HTMLElement | undefined;
  if (!generatedCell) fail(`${width}px: generated cell is missing`);
  generatedCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
  if (byLabel("Edit row 1 computed")) fail(`${width}px: generated cell incorrectly opened the editor`);

  const miscCell = [...container.querySelectorAll("td")].find((cell) => cell.textContent?.trim() === "42");
  if (!miscCell) fail(`${width}px: untyped numeric cell is missing`);
  miscCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
  const miscEditor = byLabel("Edit row 1 misc") as HTMLInputElement | null;
  if (!miscEditor) fail(`${width}px: untyped cell did not open the editor`);
  miscEditor.dispatchEvent(new Event("focusout", { bubbles: true }));
  await settle();
  if ([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Review 1 change"))) fail(`${width}px: blur with no input staged a phantom type-changing edit`);

  const addRow = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Add row");
  addRow?.click();
  await settle();
  if (!byLabel("Close add row")) fail(`${width}px: add-row modal is not visible`);
  if (byLabel("New computed")) fail(`${width}px: generated column is editable in the add-row modal`);
  const stageDefault = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Stage row");
  stageDefault?.click();
  await settle();
  if (![...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Review 1 change"))) fail(`${width}px: default-values row was not staged`);
  [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Revert")?.click();
  await settle();

  const editRow = byLabel("Edit row 1");
  if (!editRow) fail(`${width}px: per-row edit action is missing`);
  editRow.click();
  await settle();
  if (!container.querySelector('[role="dialog"][aria-label="Edit row"]')) fail(`${width}px: edit-row modal is not visible`);
  const nameField = byLabel("Edit field name") as HTMLInputElement | null;
  if (!nameField || nameField.value !== "Ada") fail(`${width}px: edit-row modal is not pre-filled with the row's values`);
  const generatedField = byLabel("Edit field computed") as HTMLInputElement | null;
  if (!generatedField || !generatedField.disabled) fail(`${width}px: generated column is editable in the edit-row modal`);
  const identityField = byLabel("Edit field seq") as HTMLInputElement | null;
  if (!identityField || !identityField.disabled) fail(`${width}px: identity column is editable in the edit-row modal`);
  setInput(nameField, "Augusta");
  await settle();
  [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Stage changes")?.click();
  await settle();
  if (![...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Review 1 change"))) fail(`${width}px: modal edit was not staged`);
  [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Revert")?.click();
  await settle();

  byLabel("Edit row 3")?.click();
  await settle();
  const binaryField = byLabel("Edit field name") as HTMLInputElement | null;
  if (!binaryField || !binaryField.disabled) fail(`${width}px: binary column is editable in the edit-row modal`);
  byLabel("Close edit row")?.click();
  await settle();

  const importCsv = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Import CSV");
  importCsv?.click();
  await settle();
  const csvContent = container.querySelector('[aria-label="CSV content"]') as HTMLTextAreaElement | null;
  if (!csvContent) fail(`${width}px: CSV import modal is not visible`);
  setValue(csvContent, "id,name,computed\n3,Katherine,6");
  await settle();
  const stageImport = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Stage import");
  stageImport?.click();
  await settle();
  if (!container.textContent?.includes("not writable: computed")) fail(`${width}px: CSV import accepted a generated column`);
  setValue(csvContent, "id,name\n3,Katherine\n4,Dorothy");
  await settle();
  stageImport?.click();
  await settle();
  if (![...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Review 2 changes"))) fail(`${width}px: CSV rows were not staged`);
  const revertImport = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Revert");
  revertImport?.click();
  await settle();

  const adaCell = [...container.querySelectorAll("td")].find((cell) => cell.textContent?.trim() === "Ada");
  if (!adaCell) fail(`${width}px: editable cell is missing`);
  adaCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
  const editor = byLabel("Edit row 1 name") as HTMLInputElement | null;
  if (!editor) fail(`${width}px: double-click did not open the cell editor`);
  editor.value = "Augusta";
  editor.dispatchEvent(new Event("focusout", { bubbles: true }));
  await settle();

  const review = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Review 1 change"));
  if (!review) fail(`${width}px: staged change is not reviewable`);
  review.click();
  await settle();
  if (!container.querySelector('[role="dialog"][aria-label="Review row changes"]')) fail(`${width}px: review modal is not visible`);
  const apply = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Apply transaction");
  apply?.click();
  await settle();
  await settle();
  if (!events.includes("dirty:true")) fail(`${width}px: staged edit did not lock navigation`);
  if (!events.includes("applied")) fail(`${width}px: apply transaction did not complete`);

  // A refresh landing after an edit is staged must drop index-keyed staging,
  // or the change would retarget onto whatever row now holds that index.
  const adaAgain = [...container.querySelectorAll("td")].find((cell) => cell.textContent?.trim() === "Ada");
  adaAgain?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
  const lateEditor = byLabel("Edit row 1 name") as HTMLInputElement | null;
  if (!lateEditor) fail(`${width}px: cell editor did not reopen for the result-replacement check`);
  lateEditor.value = "Augusta";
  lateEditor.dispatchEvent(new Event("focusout", { bubbles: true }));
  await settle();
  if (![...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Review 1 change"))) fail(`${width}px: re-staged edit is missing`);
  render({ ...baseResult, rows: [...baseResult.rows].reverse() });
  await settle();
  if ([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Review 1 change"))) fail(`${width}px: staged edit survived a result replacement`);

  // While a review preview is in flight, new staging is blocked and Revert
  // cancels the pending modal — then Apply sends exactly the reviewed set.
  render(baseResult);
  await settle();
  holdPreview = true;
  [...container.querySelectorAll("td")].find((cell) => cell.textContent?.trim() === "Ada")
    ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
  const snapshotEditor = byLabel("Edit row 1 name") as HTMLInputElement | null;
  if (!snapshotEditor) fail(`${width}px: cell editor did not open for the apply-snapshot check`);
  snapshotEditor.value = "Augusta";
  snapshotEditor.dispatchEvent(new Event("focusout", { bubbles: true }));
  await settle();
  [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Review 1 change"))?.click();
  await settle();
  if (container.querySelector('[role="dialog"][aria-label="Review row changes"]')) fail(`${width}px: review modal opened before its preview resolved`);
  const idCell = container.querySelectorAll("tbody tr")[0]?.querySelectorAll("td")[2] as HTMLElement | undefined;
  idCell?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
  if (byLabel("Edit row 1 id")) fail(`${width}px: a cell editor opened while a review was in flight`);
  if (!byLabel("Edit row 1")?.hasAttribute("disabled")) fail(`${width}px: row edit was not blocked while a review was in flight`);
  [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Revert")?.click();
  await settle();
  flushPreview();
  await settle();
  if (container.querySelector('[role="dialog"][aria-label="Review row changes"]')) fail(`${width}px: review modal opened after Revert cancelled it`);

  [...container.querySelectorAll("td")].find((cell) => cell.textContent?.trim() === "Ada")
    ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await settle();
  const restageEditor = byLabel("Edit row 1 name") as HTMLInputElement | null;
  if (!restageEditor) fail(`${width}px: cell editor did not reopen after the cancelled review`);
  restageEditor.value = "Augusta";
  restageEditor.dispatchEvent(new Event("focusout", { bubbles: true }));
  await settle();
  [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Review 1 change"))?.click();
  await settle();
  await settle();
  [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Apply transaction")?.click();
  await settle();
  await settle();
  if (!lastApplyBody || lastApplyBody.changes?.length !== 1) fail(`${width}px: apply sent ${lastApplyBody?.changes?.length ?? "no"} changes instead of the reviewed one`);

  flushSync(() => root.unmount());
  container.remove();
}

async function exerciseNoIdentity() {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  const { DataGrid } = await import("../src/WorkspaceDatabaseView.tsx");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(React.createElement(DataGrid, {
    table: {
      name: "logs", type: "table", rowCount: -1, ddl: "",
      columns: [
        { name: "id", type: "integer", notNull: false, pk: false, fk: null },
        { name: "msg", type: "text", notNull: false, pk: false, fk: null },
      ],
    },
    source: { kind: "sqlite", path: "/tmp/smoke.sqlite" },
    writable: true,
    columns: ["id", "msg"],
    result: {
      columns: ["id", "msg"],
      rows: [{ id: 1, msg: "hi" }],
      ms: 0.5,
      hasMore: false,
      offset: 0,
    },
    sorts: [],
    pageSize: 100,
    onSort: () => {},
    onPrevious: () => {},
    onNext: () => {},
    onPageSize: () => {},
    onDirtyChange: () => {},
    onApplied: () => {},
    onExportAll: async () => ({ columns: [], rows: [] }),
  })));

  if (container.querySelector('[aria-label="Edit row 1"]')) fail("row edit is offered without a detected row identity");
  const del = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Delete selected");
  if (del && !del.hasAttribute("disabled")) fail("delete is offered without a detected row identity");
  if (!container.textContent?.includes("Updates require a primary or non-null unique key")) fail("identity hint is missing");

  flushSync(() => root.unmount());
  container.remove();
}

await exercise(1280);
await exercise(480);
await exerciseNoIdentity();
console.log("PASS: data grid browse/edit/review/apply works at 1280px and 480px");
