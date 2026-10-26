import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { Direction, type EditorView, type ViewUpdate } from "@codemirror/view";
import { editorDecorations, ListContinuationAlignment, listAlignmentOffsets } from "../src/editor-extension.ts";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

// Exercise the real read/write measurement phases without opening a browser.
function setup(prefix = "- [ ] ", options: { rtl?: boolean; scale?: number; active?: boolean } = {}) {
  const state = EditorState.create({
    doc: `${prefix}Parent\n${" ".repeat(prefix.replace(/\t/g, "    ").length)}Continuation`,
    extensions: [listAlignmentOffsets]
  });
  const properties = new Map<string, string>();
  const style = {
    paddingInlineStart: "37px", textIndent: "-37px",
    writes: 0,
    getPropertyValue(name: string) { return properties.get(name) ?? ""; },
    setProperty(name: string, value: string) { properties.set(name, value); this.writes++; },
    removeProperty(name: string) { properties.delete(name); }
  };
  let contentFrom = "";
  editorDecorations(state).between(0, state.doc.length, (_from, _to, value) => {
    contentFrom = value.spec.attributes?.["data-ray-notes-list-content-from"] ?? contentFrom;
  });
  const parent = {
    classList: { contains: () => false },
    getBoundingClientRect: () => ({ left: 100, right: 500 })
  };
  const continuation = {
    classList: { contains: (name: string): boolean => name === "ray-notes-list-continuation" },
    dataset: { rayNotesListContentFrom: contentFrom }, style,
    getBoundingClientRect: () => {
      const shift = parseFloat(properties.get("--ray-notes-list-continuation-offset") ?? "0") * (options.scale ?? 1);
      return options.rtl ? { left: 100, right: 500 - shift } : { left: 100 + shift, right: 500 };
    }
  };
  let lines: unknown[] = [parent, continuation];
  let inset = 23.75;
  let pending: { read(): unknown; write(result: unknown): void };
  const view = {
    state, scaleX: options.scale ?? 1, defaultCharacterWidth: 7,
    dom: { ownerDocument: { body: { matches: () => options.active ?? true } } },
    contentDOM: { querySelectorAll: () => lines },
    requestMeasure(request: typeof pending) { pending = request; },
    dispatch(spec: TransactionSpec) {
      this.state = this.state.update(spec).state;
      properties.clear();
      const offset = this.state.field(listAlignmentOffsets).get(this.state.doc.line(2).from);
      if (offset !== undefined) properties.set("--ray-notes-list-continuation-offset", `${offset}px`);
      style.writes++;
    },
    posAtDOM(element: unknown) { return element === parent ? 0 : state.doc.line(2).from; },
    coordsAtPos(pos: number) {
      const isParent = pos === prefix.length;
      if (!isParent) assert.equal(pos, state.doc.line(2).from + prefix.replace(/\t/g, "    ").length);
      const bounds = isParent ? parent.getBoundingClientRect() : continuation.getBoundingClientRect();
      const offset = (isParent ? inset : 37) * this.scaleX;
      return options.rtl
        ? { left: bounds.right - offset, right: bounds.right - offset }
        : { left: bounds.left + offset, right: bounds.left + offset };
    },
    textDirectionAt: () => options.rtl ? Direction.RTL : Direction.LTR
  };
  const alignment = new ListContinuationAlignment(view as unknown as EditorView);
  return {
    state, alignment, view, parent, continuation, properties, style,
    setInset(value: number) { inset = value; },
    hideParent() { lines = [continuation]; },
    async flush() { pending.write(pending.read()); await Promise.resolve(); },
    update(flags: Partial<ViewUpdate>) {
      alignment.update({ docChanged: false, viewportChanged: false, geometryChanged: false, ...flags } as ViewUpdate);
    }
  };
}

test("aligns whole continuation lines to measured text edges for each marker and five list levels", async () => {
  for (const marker of ["- ", "1. ", "100. ", "- [ ] ", "- [x] ", "- [?] "]) {
    for (let level = 0; level < 5; level++) {
      const fixture = setup(`${"\t".repeat(level)}${marker}`);
      const expected = 23.75 + level * 14;
      fixture.setInset(expected);
      await fixture.flush();
      assert.equal(fixture.properties.get("--ray-notes-list-continuation-offset"), `${expected - 37}px`);
      assert.equal(fixture.style.paddingInlineStart, "37px", "native inline measurements must not be replaced");
      assert.equal(fixture.style.textIndent, "-37px");
      assert.equal(fixture.state.doc.toString().endsWith("Continuation"), true);
    }
  }
});

test("accounts for transformed and right-to-left editors", async () => {
  const fixture = setup("1. ", { rtl: true, scale: 2 });
  await fixture.flush();
  assert.equal(fixture.properties.get("--ray-notes-list-continuation-offset"), "-13.25px");
});

test("recalculates measured widths when typography changes", async () => {
  const fixture = setup();
  await fixture.flush();
  fixture.view.defaultCharacterWidth = 10;
  fixture.setInset(32.5);
  fixture.update({ geometryChanged: true });
  await fixture.flush();
  assert.equal(fixture.properties.get("--ray-notes-list-continuation-offset"), "-4.5px");
});

test("retains the measured parent when it scrolls outside the rendered viewport", async () => {
  const fixture = setup();
  await fixture.flush();
  fixture.hideParent();
  fixture.update({ viewportChanged: true });
  await fixture.flush();
  assert.equal(fixture.properties.get("--ray-notes-list-continuation-offset"), "-13.25px");
});

test("does not reuse a stale parent's width after an edit", async () => {
  const fixture = setup();
  await fixture.flush();
  fixture.hideParent();
  fixture.update({ docChanged: true });
  await fixture.flush();
  assert.equal(fixture.properties.has("--ray-notes-list-continuation-offset"), false);
});

test("leaves list items, blockquotes, and ordinary Obsidian editors untouched", async () => {
  const fixture = setup();
  fixture.continuation.classList.contains = name => name === "ray-notes-list-continuation" || name === "ray-notes-quote-depth";
  await fixture.flush();
  assert.equal(fixture.properties.size, 0);
  const ordinary = setup("- ", { active: false });
  await ordinary.flush();
  assert.equal(ordinary.properties.size, 0);
  assert.equal(ordinary.style.paddingInlineStart, "37px");
});

test("does not accumulate line movement on repeated measurements", async () => {
  const fixture = setup();
  await fixture.flush();
  for (let index = 0; index < 3; index++) {
    fixture.update({ geometryChanged: true });
    await fixture.flush();
    assert.equal(fixture.properties.get("--ray-notes-list-continuation-offset"), "-13.25px");
  }
  assert.equal(fixture.style.writes, 1, "unchanged measurements must not cause DOM writes");
});

test("keeps measured offsets in editor state through selection redraws and clears them after source edits", async () => {
  const fixture = setup();
  await fixture.flush();
  const from = fixture.view.state.doc.line(2).from;
  const selected = fixture.view.state.update({ selection: { anchor: from } }).state;
  assert.equal(selected.field(listAlignmentOffsets).get(from), -13.25);
  const edited = selected.update({ changes: { from: 0, insert: "New line\n" } }).state;
  assert.equal(edited.field(listAlignmentOffsets).size, 0);
});

test("alignment CSS leaves native padding and text-indent untouched without important overrides", () => {
  const start = css.indexOf(".cm-line.ray-notes-list-continuation:not(.ray-notes-quote-depth) {");
  assert.notEqual(start, -1);
  const rule = css.slice(start, css.indexOf("}", start));
  assert.doesNotMatch(rule, /!important|padding-inline-start|text-indent\s*:/);
  assert.match(rule, /inset-inline-start: calc\(/);
  assert.match(rule, /width: calc\(/);
});

test("defers editor transactions until after the measurement cycle and ignores destroyed views", async () => {
  const fixture = setup();
  const pending = fixture.flush();
  assert.equal(fixture.style.writes, 0, "dispatching during measurement throws in the real editor");
  await pending;
  assert.equal(fixture.style.writes, 1);
  fixture.setInset(40);
  fixture.update({ geometryChanged: true });
  const destroyed = fixture.flush();
  fixture.alignment.destroy();
  await destroyed;
  assert.equal(fixture.style.writes, 1);
});

test("does not apply a queued measurement to a newer document", async () => {
  const fixture = setup();
  const pending = fixture.flush();
  fixture.view.state = fixture.view.state.update({ changes: { from: 0, insert: "Title\n" } }).state;
  await pending;
  assert.equal(fixture.style.writes, 0);
});
