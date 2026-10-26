import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transpileModule, ScriptTarget } from "typescript";
import { shouldHideWindowOnEscape } from "../src/window.ts";

const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const start = source.indexOf('this.registerDomEvent(win, "keydown", (event) => {');
const end = source.indexOf("\n    }, true);", start);
const listener = transpileModule(source.slice(start, end + "\n    }, true);".length), {
  compilerOptions: { target: ScriptTarget.ES2022 }
}).outputText;

class MarkdownView {
  editor = { hasFocus: () => true };
}
const adapterSource = source.slice(source.indexOf("  private shouldDeferEscapeToVim("), source.indexOf("  private hasOpenOverlay("));
const Adapter = runInNewContext(transpileModule(`class Adapter { ${adapterSource} }; Adapter`, {
  compilerOptions: { target: ScriptTarget.ES2022 }
}).outputText, { MarkdownView });

function escape(options: {
  vimEditing?: boolean;
  vimEnabled?: boolean;
  vimState?: { insertMode?: boolean; overwrite?: boolean; visualMode?: boolean } | null;
  editorFocused?: boolean;
  overlay?: boolean;
  composing?: boolean;
} = {}) {
  const calls: string[] = [];
  let handler!: (event: KeyboardEvent) => void;
  const doc = { querySelector: () => null };
  const view = Object.assign(new MarkdownView(), {
    editor: { hasFocus: () => options.editorFocused !== false },
    sourceMode: { cmEditor: { cm: { cm: { state: {
      vim: options.vimState === null ? undefined : options.vimState ?? { insertMode: !!options.vimEditing, overwrite: false }
    } } } } }
  });
  const context = { leaf: { view }, activeLayer: options.overlay ? {} : null, escapeSuppressedUntil: 0 };
  const plugin = {
    activateWindow() {},
    app: { isVimEnabled: () => options.vimEnabled ?? !!options.vimEditing },
    shouldDeferEscapeToVim: Adapter.prototype.shouldDeferEscapeToVim,
    closeActiveLayer: () => calls.push("close-layer"),
    hideWindow: () => calls.push("hide"),
    closeOpenDocumentSearch: () => false,
    hasOpenOverlay: () => false,
    registerDomEvent(_window: unknown, _name: string, callback: typeof handler) { handler = callback; }
  };
  runInNewContext(`(function () { ${listener} }).call(plugin)`, {
    plugin, doc, document: doc, win: {}, context, IS_MACOS: true,
    shouldHideWindowOnEscape, isImeProcessKey: () => false
  });
  const event = {
    key: "Escape", code: "Escape", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
    isComposing: !!options.composing, defaultPrevented: false, stopped: false, immediateStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.immediateStopped = true; }
  };
  handler(event as unknown as KeyboardEvent);
  return { calls, event };
}

test("Vim editing Escape reaches the native editor without hiding", () => {
  const { calls, event } = escape({ vimEditing: true });
  assert.deepEqual(calls, []);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.stopped, false);
  assert.equal(event.immediateStopped, false);
});

test("Escape closes a plugin overlay before deferring to Vim", () => {
  const { calls, event } = escape({ vimEditing: true, overlay: true });
  assert.deepEqual(calls, ["close-layer"]);
  assert.equal(event.defaultPrevented, true);
});

test("normal mode and non-Vim Escape retain the hide action", () => {
  for (const vimEnabled of [false, true]) {
    const { calls, event } = escape({ vimEnabled, vimState: { insertMode: false, overwrite: false } });
    assert.deepEqual(calls, ["hide"]);
    assert.equal(event.defaultPrevented, true);
  }
});

test("IME Escape is left to composition", () => {
  const { calls, event } = escape({ composing: true });
  assert.deepEqual(calls, []);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.stopped, false);
});

test("IME Escape keeps priority over an open plugin overlay", () => {
  const { calls, event } = escape({ composing: true, overlay: true });
  assert.deepEqual(calls, []);
  assert.equal(event.defaultPrevented, false);
});


test("native Vim overwrite and unavailable state safely retain Escape", () => {
  for (const vimState of [{ insertMode: true, overwrite: true }, null, {}]) {
    const { calls, event } = escape({ vimEnabled: true, vimState });
    assert.deepEqual(calls, []);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.stopped, false);
  }
});

test("Vim editing does not retain Escape when the editor lacks focus", () => {
  const { calls } = escape({ vimEditing: true, editorFocused: false });
  assert.deepEqual(calls, ["hide"]);
});


test("Vim Visual Escape reaches the native editor instead of hiding the window", () => {
  const { calls, event } = escape({
    vimEnabled: true,
    vimState: { insertMode: false, overwrite: false, visualMode: true }
  });
  assert.deepEqual(calls, []);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.stopped, false);
  assert.equal(event.immediateStopped, false);
});
