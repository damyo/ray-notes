import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("main.ts",
  readFileSync(new URL("../src/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.ES2022, true);
const declaration = source.statements.find(statement => ts.isClassDeclaration(statement)
  && statement.name?.text === "RayNotesPlugin") as ts.ClassDeclaration;
const names = ["showWindow", "configureNativePopout", "syncWindowControls", "toggleAlwaysOnTop", "toggleWorkspacePin", "showPinnedWindow"];
const methods = declaration.members.filter(member => ts.isMethodDeclaration(member)
  && names.includes(member.name.getText(source))).map(member => member.getText(source));
assert.equal(methods.length, names.length);
const script = ts.transpileModule(`class Subject { ${methods.join("\n")} }; Subject;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;

function setup(mac = true) {
  const calls: string[] = [];
  const timers: Array<{ callback(): void; delay: number }> = [];
  let nativeTop = true;
  let nativeSpaces = true;
  let visible = true;
  let policy = "regular";
  const native = {
    setVisibleOnAllWorkspaces(value: boolean, options: { visibleOnFullScreen: boolean; skipTransformProcessType?: boolean }) {
      nativeSpaces = value;
      // Simulate native flags changing while macOS updates window collection behavior.
      nativeTop = false;
      if (!options.skipTransformProcessType) visible = false;
      calls.push(`spaces:${value}:${options.visibleOnFullScreen}:${!!options.skipTransformProcessType}`);
    },
    isVisibleOnAllWorkspaces: () => nativeSpaces,
    setAlwaysOnTop(value: boolean) { nativeTop = value; calls.push(`top:${value}`); },
    isAlwaysOnTop: () => nativeTop,
    isVisible: () => visible,
    hide() { visible = false; calls.push("hide"); },
    show() { visible = true; calls.push("show"); },
    showInactive() { visible = true; calls.push("showInactive"); },
    focus() { calls.push("focus"); },
    moveTop() { calls.push("moveTop"); }
  };
  const win = {
    focus() {},
    setTimeout(callback: () => void, delay: number) { timers.push({ callback, delay }); },
    requestAnimationFrame(callback: () => void) { callback(); },
    require: () => ({ remote: { getCurrentWindow: () => native } })
  };
  const context = {
    nativePopout: native, visibleOnAllWorkspaces: true, alwaysOnTop: true, hidden: false,
    workspacePinButton: null, alwaysOnTopButton: null, popout: { win },
    leaf: { getViewState: () => ({ state: { mode: "source" } }) }
  };
  const Subject = runInNewContext(script, { IS_MACOS: mac, MIN_WINDOW_WIDTH: 396, MarkdownView: class {},
    console: { warn() { calls.push("warn"); } } });
  const plugin = new Subject();
  const snapshots: boolean[] = [];
  Object.assign(plugin, {
    activeWindow: context,
    settings: { visibleOnAllWorkspaces: true },
    activateWindow() {}, updateToggleButton() {}, setTrafficLightsVisible() {},
    async saveSettings() { snapshots.push(plugin.settings.visibleOnAllWorkspaces); },
    electronApp: {
      setActivationPolicy(value: string) { policy = value; calls.push(`policy:${value}`); },
      dock: { async show() { calls.push("dock.show"); visible = true; } }
    }
  });
  return { plugin, context, native, win, calls, timers, snapshots, policy: () => policy };
}

test("pin toggles preserve fullscreen capability without process or Dock transitions", async () => {
  const { plugin, context, calls, native } = setup();
  await plugin.toggleWorkspacePin(context);
  assert.equal(context.visibleOnAllWorkspaces, false);
  assert.equal(native.isVisible(), true);
  assert.equal(native.isAlwaysOnTop(), true);
  assert.deepEqual(calls, ["show", "focus", "spaces:false:true:true", "top:true", "showInactive", "moveTop"]);
  calls.length = 0;
  await plugin.toggleWorkspacePin(context);
  assert.deepEqual(calls, ["spaces:true:true:true", "top:true", "showInactive"]);
  assert.equal(calls.includes("focus"), false, "repinning must not activate Obsidian on another Space");
});

test("Space toggles do not enable Always on Top or reveal deliberately hidden windows", async () => {
  const { plugin, context, calls, native } = setup();
  context.alwaysOnTop = false;
  context.hidden = true;
  await plugin.toggleWorkspacePin(context);
  assert.equal(native.isAlwaysOnTop(), false);
  assert.equal(context.hidden, true);
  assert.deepEqual(calls, ["spaces:false:true:true", "top:false"]);
});

test("transient native flags cannot overwrite requested control states", () => {
  const { plugin, context, native } = setup();
  native.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: false, skipTransformProcessType: true });
  plugin.syncWindowControls(context);
  assert.equal(context.visibleOnAllWorkspaces, true);
  assert.equal(context.alwaysOnTop, true);
  plugin.toggleAlwaysOnTop(context);
  assert.equal(context.alwaysOnTop, false);
  assert.equal(native.isAlwaysOnTop(), false);
});

test("delayed unpin after showing a note cannot undo a newer pin request", async () => {
  const { plugin, context, native, timers, calls } = setup();
  context.visibleOnAllWorkspaces = false;
  await plugin.showWindow(context);
  assert.equal(native.isVisibleOnAllWorkspaces(), true);
  plugin.syncWindowControls(context);
  assert.equal(context.visibleOnAllWorkspaces, false);
  assert.equal(calls.includes("dock.show"), false);
  await plugin.toggleWorkspacePin(context);
  timers.find(timer => timer.delay === 120)!.callback();
  assert.equal(native.isVisibleOnAllWorkspaces(), true);
  assert.equal(context.visibleOnAllWorkspaces, true);
  assert.equal(calls.includes("policy:accessory"), false);
  assert.equal(calls.includes("dock.show"), false);
});

test("an unpinned note retains fullscreen capability when temporary all-Space membership ends", async () => {
  const { plugin, context, timers, calls } = setup();
  context.visibleOnAllWorkspaces = false;
  await plugin.showWindow(context);
  timers.find(timer => timer.delay === 120)!.callback();
  assert.deepEqual(calls.slice(-2), ["spaces:false:true:true", "top:true"]);
  assert.equal(context.nativePopout.isAlwaysOnTop(), true);
});

test("showing a pinned note focuses only once without repeating app initialization", async () => {
  const { plugin, context, calls, timers } = setup();
  await plugin.showWindow(context);
  assert.deepEqual(calls, ["spaces:true:true:true", "top:true", "showInactive", "focus"]);
  assert.equal(timers.filter(timer => timer.delay === 80).length, 0);
  timers.find(timer => timer.delay === 0)!.callback();
  assert.equal(calls.filter(call => call === "focus").length, 1);
});

test("repinning preserves the requested top state without activating the app or window", async () => {
  for (const top of [false, true]) {
    const { plugin, context, calls, native, policy } = setup();
    context.alwaysOnTop = top;
    context.visibleOnAllWorkspaces = false;
    await plugin.toggleWorkspacePin(context);
    assert.equal(native.isVisibleOnAllWorkspaces(), true);
    assert.equal(native.isVisible(), true);
    assert.equal(native.isAlwaysOnTop(), top);
    assert.equal(policy(), "regular");
    assert.equal(calls.some(call => ["show", "focus", "dock.show"].includes(call)), false);
  }
});

test("a queued focus cannot reshow or activate a note hidden by a newer action", async () => {
  const { plugin, context, calls, timers } = setup();
  context.visibleOnAllWorkspaces = false;
  await plugin.showWindow(context);
  context.hidden = true;
  timers.find(timer => timer.delay === 0)!.callback();
  assert.equal(calls.includes("focus"), false);
});

test("hidden and closed notes cannot be revealed by a stale pinned-window request", () => {
  for (const cancel of ["hide", "close"]) {
    const { plugin, context, calls, win } = setup();
    if (cancel === "hide") context.hidden = true;
    else Object.assign(win, { closed: true });
    plugin.showPinnedWindow(context);
    assert.deepEqual(calls, []);
  }
});

test("initial setup restores the Dock policy even when fullscreen registration fails", async () => {
  const { plugin, native, policy, calls, win } = setup();
  native.setVisibleOnAllWorkspaces = () => { throw new Error("native failure"); };
  await plugin.configureNativePopout(win);
  assert.equal(policy(), "regular");
  assert.equal(calls.at(-2), "policy:regular");
  assert.equal(calls.at(-1), "warn");
  assert.equal(calls.includes("dock.show"), false);
});

test("rapid toggles persist the final requested state", async () => {
  const { plugin, context, snapshots } = setup();
  await Promise.all([plugin.toggleWorkspacePin(context), plugin.toggleWorkspacePin(context)]);
  assert.deepEqual(snapshots, [false, true]);
  assert.equal(context.visibleOnAllWorkspaces, true);
});

test("initial policy recovery is followed by reapplying the requested top state without dock.show", async () => {
  const { plugin, context, win, native, calls } = setup();
  await plugin.configureNativePopout(win);
  assert.equal(native.isAlwaysOnTop(), context.alwaysOnTop);
  assert(calls.lastIndexOf("top:true") > calls.indexOf("policy:regular"));
  assert.equal(calls.includes("dock.show"), false);
});

test("a note initially created unpinned is fullscreen-capable before its first pin cycle", async () => {
  const { plugin, context, calls, win } = setup();
  context.visibleOnAllWorkspaces = false;
  await plugin.configureNativePopout(win);
  assert.equal(calls.includes("spaces:false:true:true"), true);
  calls.length = 0;
  await plugin.toggleWorkspacePin(context);
  assert.deepEqual(calls, ["spaces:true:true:true", "top:true", "showInactive"]);
});

test("later pin and reopen cycles never clear the fullscreen role or change app policy", async () => {
  const { plugin, context, calls, win } = setup();
  await plugin.configureNativePopout(win);
  calls.length = 0;
  for (let cycle = 0; cycle < 3; cycle++) {
    await plugin.toggleWorkspacePin(context);
    await plugin.toggleWorkspacePin(context);
    await plugin.showWindow(context);
  }
  assert.equal(calls.some(call => call.startsWith("policy:")), false);
  assert.equal(calls.filter(call => call.startsWith("spaces:")).every(call => call.endsWith(":true:true")), true);
});

test("macOS workspace controls remain inactive on other platforms", async () => {
  const { plugin, context, calls } = setup(false);
  await plugin.toggleWorkspacePin(context);
  assert.deepEqual(calls, []);
});
