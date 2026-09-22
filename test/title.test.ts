import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import {
  advancePosition,
  calloutHeaderLine,
  codeFenceOpeningLine,
  extraBlankLineGaps,
  headingEdit,
  imeFocusDelay,
  isImeInteractionPending,
  linePrefixEdit,
  matchesAllSearchTerms,
  restoreUnexpectedTaskPrefix,
  toggleWrapEdit
} from "../src/editor.ts";
import { plainNotePreview, safeFileName, titleFromFirstLine, titleFromLines, withHeadingTitle } from "../src/title.ts";
import {
  draggedWindowBounds,
  fittedRestoreBounds,
  formatOpenedAt,
  pointInsideBounds,
  relativeNotePath,
  shortcutAccelerator,
  shouldHideWindowOnEscape,
  sortNotePaths,
  usesNewWindowModifier
} from "../src/window.ts";
import { rayNotesEditorDecorationsExtension } from "../src/editor-extension.ts";

test("derives a plain title from formatted first lines", () => {
  assert.equal(titleFromFirstLine("# **Ray Notes**"), "Ray Notes");
  assert.equal(titleFromFirstLine("> [[Notes/Ray|Ray Notes]]"), "Ray Notes");
  assert.equal(titleFromFirstLine(""), "Untitled");
  assert.equal(safeFileName('Ray / Notes: "Draft"'), "Ray Notes Draft");
});

test("uses callout content instead of callout metadata as the title", () => {
  assert.equal(titleFromLines([">[!tip]", ">sdfsd", ""]), "sdfsd");
  assert.equal(titleFromLines(["", "# Notes"]), "Notes");
});

test("ignores frontmatter and fenced code when deriving a title", () => {
  assert.equal(titleFromLines(["---", "tags: [test]", "---", "# **Visible title**"]), "Visible title");
  assert.equal(titleFromLines(["```ts", "const hidden = true", "```", "[Visible](https://example.com)"]), "Visible");
});

test("falls back to the first meaningful code line for code-only notes", () => {
  const note = "```html\n<!-- header.html -->\n<!-- 상품검색 화면 —>\n<div class=\"search-form\">\n```";
  assert.equal(titleFromLines(note.split("\n")), "<!-- header.html -->");
  assert.deepEqual(plainNotePreview(note), {
    title: "<!-- header.html -->",
    body: '<!-- 상품검색 화면 —> <div class="search-form">'
  });
});

test("ignores image embeds when deriving the note title", () => {
  assert.equal(titleFromLines(["![[Pasted image 20260902.png]]", "", "Actual title"]), "Actual title");
  assert.equal(titleFromLines(["![diagram](assets/diagram.png)"]), "Untitled");
  assert.equal(titleFromFirstLine("![[Pasted image.png]] Caption"), "Caption");
});

test("preserves a moved note title as an H1 after frontmatter", () => {
  assert.equal(withHeadingTitle("Body", "Existing title"), "# Existing title\n\nBody");
  assert.equal(
    withHeadingTitle("---\ntags: [test]\n---\nBody", "Existing title"),
    "---\ntags: [test]\n---\n# Existing title\n\nBody"
  );
  assert.equal(withHeadingTitle("# Existing\n\nBody", "Ignored"), "# Existing\n\nBody");
  assert.equal(withHeadingTitle("Body\n\n# Later", "Existing title"), "# Existing title\n\nBody\n\n# Later");
});

test("builds a plain compact preview without Markdown markers", () => {
  assert.deepEqual(plainNotePreview("# **Title**\n\n- [ ] First line\n> [Second](https://example.com)"), {
    title: "Title",
    body: "First line Second"
  });
});

test("advances editor positions through inline and multiline wrappers", () => {
  assert.deepEqual(advancePosition({ line: 2, ch: 4 }, "**"), { line: 2, ch: 6 });
  assert.deepEqual(advancePosition({ line: 2, ch: 4 }, "a\nbc"), { line: 3, ch: 2 });
});

test("toggles matching wrappers instead of nesting them", () => {
  assert.deepEqual(toggleWrapEdit("Text", 0, 4, "**"), {
    from: 0, to: 4, text: "**Text**", selectionFrom: 2, selectionTo: 6
  });
  assert.deepEqual(toggleWrapEdit("**Text**", 2, 6, "**"), {
    from: 0, to: 8, text: "Text", selectionFrom: 0, selectionTo: 4
  });
  assert.deepEqual(toggleWrapEdit("``", 1, 1, "`"), {
    from: 0, to: 2, text: "", selectionFrom: 0, selectionTo: 0
  });
});

test("decorates list continuation lines without touching list item lines", () => {
  const state = EditorState.create({
    doc: "- bullet\n  continuation\n  - nested\n    nested continuation\n9. ordered\n   ordered continuation\n  1. nested ordered\n      nested ordered continuation\n- [ ] task\n      task continuation\n\t- [ ] nested task\n\t      nested task continuation\nplain",
    extensions: [rayNotesEditorDecorationsExtension]
  });
  const decorations = state.field(rayNotesEditorDecorationsExtension);
  const decoratedLines: number[] = [];
  const styles: string[] = [];
  decorations.between(0, state.doc.length, (from, _to, value) => {
    decoratedLines.push(state.doc.lineAt(from).number);
    styles.push(String(value.spec.attributes?.style));
  });
  assert.deepEqual(decoratedLines, [2, 4, 6, 8, 10, 12]);
  assert.equal(styles[0].includes("calc(2em + -7px)"), true);
  assert.equal(styles[1].includes("calc(2em + 0.5px)"), true);
  assert.equal(styles[2].includes("calc(2em + -8px)"), true);
  assert.equal(styles[3].includes("calc(2em + -0.5px)"), true);
  assert.equal(styles[4].includes("calc(2em + -8px)"), true);
  assert.equal(styles[5].includes("calc(2em + 13.5px)"), true);
});

test("records blockquote depth on the complete quote line", () => {
  const state = EditorState.create({
    doc: "> first\n>> second\n  > indented\n    > deeper",
    extensions: [rayNotesEditorDecorationsExtension]
  });
  const depths: string[] = [];
  state.field(rayNotesEditorDecorationsExtension).between(0, state.doc.length, (_from, _to, value) => {
    const style = value.spec.attributes?.style;
    if (typeof style === "string" && style.includes("quote-depth")) depths.push(style);
  });
  assert.deepEqual(depths, [
    "--ray-notes-quote-depth: 1; --ray-notes-quote-offset: 0px; --ray-notes-quote-active-offset: 0px; --ray-notes-quote-marker-offset: 0px; --ray-notes-quote-whitespace-offset: 3.5px; --ray-notes-quote-hidden-offset: -3.5px",
    "--ray-notes-quote-depth: 2; --ray-notes-quote-offset: 14.5px; --ray-notes-quote-active-offset: 0px; --ray-notes-quote-marker-offset: 9px; --ray-notes-quote-whitespace-offset: 3.5px; --ray-notes-quote-hidden-offset: -12.5px",
    "--ray-notes-quote-depth: 1; --ray-notes-quote-offset: 0px; --ray-notes-quote-active-offset: 0px; --ray-notes-quote-marker-offset: 0px; --ray-notes-quote-whitespace-offset: 10.5px; --ray-notes-quote-hidden-offset: -10.5px",
    "--ray-notes-quote-depth: 1; --ray-notes-quote-offset: 0px; --ray-notes-quote-active-offset: 0px; --ray-notes-quote-marker-offset: 0px; --ray-notes-quote-whitespace-offset: 17.5px; --ray-notes-quote-hidden-offset: -17.5px"
  ]);

  const afterList = EditorState.create({
    doc: "- item\n> quote",
    extensions: [rayNotesEditorDecorationsExtension]
  });
  let className = "";
  afterList.field(rayNotesEditorDecorationsExtension).between(0, afterList.doc.length, (from, _to, value) => {
    if (afterList.doc.lineAt(from).number === 2) className = String(value.spec.attributes?.class);
  });
  assert.equal(className.includes("ray-notes-quote-after-list"), true);
});

test("marks empty editor rows without styling whitespace-only rows", () => {
  const state = EditorState.create({
    doc: "First\n\n  \nSecond",
    extensions: [rayNotesEditorDecorationsExtension]
  });
  const decoratedLines: number[] = [];
  state.field(rayNotesEditorDecorationsExtension).between(0, state.doc.length, (from, _to, value) => {
    if (value.spec.attributes?.class === "ray-notes-blank-line") {
      decoratedLines.push(state.doc.lineAt(from).number);
    }
  });
  assert.deepEqual(decoratedLines, [2]);
});

test("inserts and replaces heading levels without losing the cursor", () => {
  assert.deepEqual(headingEdit("Notes", 5, 2), { prefix: "## ", replaceEnd: 0, cursorCh: 8 });
  assert.deepEqual(headingEdit("# Notes", 7, 3), { prefix: "### ", replaceEnd: 2, cursorCh: 9 });
  assert.deepEqual(headingEdit("## Notes", 8, 2), { prefix: "", replaceEnd: 3, cursorCh: 5 });
});

test("toggles blockquote and list prefixes instead of nesting them", () => {
  assert.deepEqual(linePrefixEdit("Text", 4, "> "), { prefix: "> ", replaceEnd: 0, cursorCh: 6 });
  assert.deepEqual(linePrefixEdit("> Text", 6, "> "), { prefix: "", replaceEnd: 2, cursorCh: 4 });
  assert.deepEqual(linePrefixEdit("- [ ] Task", 10, "- [ ] "), {
    prefix: "", replaceEnd: 6, cursorCh: 4
  });
});

test("requires every Browse Notes search term", () => {
  assert.equal(matchesAllSearchTerms("ChatGPT payment history", "chatgpt payment history"), true);
  assert.equal(matchesAllSearchTerms("ChatGPT payment", "chatgpt payment history"), false);
  assert.equal(matchesAllSearchTerms("ChatGPT 결제 내역", "chatgpt 결제 내역"), true);
});

test("finds the active code fence and callout header", () => {
  assert.equal(codeFenceOpeningLine(["```ts", "const x = 1"], 1), 0);
  assert.equal(codeFenceOpeningLine(["```ts", "x", "```", "after"], 3), null);
  assert.equal(calloutHeaderLine(["> [!tip]", "> content", "after"], 1), 0);
  assert.equal(calloutHeaderLine(["> [!tip]", "> content", "after"], 2), null);
});

test("tracks the pointer across the complete native window bounds", () => {
  const bounds = { x: 100, y: 200, width: 600, height: 500 };
  assert.equal(pointInsideBounds({ x: 100, y: 200 }, bounds), true);
  assert.equal(pointInsideBounds({ x: 699, y: 699 }, bounds), true);
  assert.equal(pointInsideBounds({ x: 700, y: 699 }, bounds), false);
  assert.equal(pointInsideBounds({ x: 704, y: 704 }, bounds, 8), true);
  assert.equal(pointInsideBounds({ x: 708, y: 708 }, bounds, 8), false);
});

test("moves a minimal window only after a drag begins", () => {
  const bounds = { x: 100, y: 200, width: 300, height: 82 };
  assert.equal(draggedWindowBounds(bounds, { x: 10, y: 10 }, { x: 11, y: 11 }), null);
  assert.deepEqual(draggedWindowBounds(bounds, { x: 10, y: 10 }, { x: 30, y: 25 }), {
    x: 120, y: 215, width: 300, height: 82
  });
});

test("keeps the top-left restore anchor unless the window would leave the screen", () => {
  const workArea = { x: 0, y: 0, width: 1440, height: 900 };
  const normal = { width: 620, height: 520 };
  assert.deepEqual(
    fittedRestoreBounds({ x: 500, y: 200, width: 300, height: 82 }, normal, workArea),
    { x: 500, y: 200, width: 620, height: 520 }
  );
  assert.deepEqual(
    fittedRestoreBounds({ x: 1120, y: 20, width: 300, height: 82 }, normal, workArea),
    { x: 800, y: 20, width: 620, height: 520 }
  );
  assert.deepEqual(
    fittedRestoreBounds({ x: 20, y: 798, width: 300, height: 82 }, normal, workArea),
    { x: 20, y: 360, width: 620, height: 520 }
  );
});

test("uses only Option to open a note in a new window", () => {
  assert.equal(usesNewWindowModifier({ altKey: true }), true);
  assert.equal(usesNewWindowModifier({ altKey: false }), false);
});

test("hides the window on bare Escape only when no overlay is open", () => {
  assert.equal(shouldHideWindowOnEscape({
    key: "Escape", hasModifier: false, isComposing: false, hasPluginOverlay: false, hasObsidianOverlay: false
  }), true);
  assert.equal(shouldHideWindowOnEscape({
    key: "Escape", hasModifier: false, isComposing: false, hasPluginOverlay: true, hasObsidianOverlay: false
  }), false);
  assert.equal(shouldHideWindowOnEscape({
    key: "Escape", hasModifier: true, isComposing: false, hasPluginOverlay: false, hasObsidianOverlay: false
  }), false);
  assert.equal(shouldHideWindowOnEscape({
    key: "Escape", hasModifier: false, isComposing: true, hasPluginOverlay: false, hasObsidianOverlay: false
  }), false);
});

test("records global shortcuts from physical keys instead of typed characters", () => {
  assert.equal(shortcutAccelerator({
    code: "KeyN", key: "Dead", metaKey: false, ctrlKey: false,
    altKey: true, shiftKey: false, platform: "darwin"
  }), "Alt+N");
  assert.equal(shortcutAccelerator({
    code: "KeyK", key: "k", metaKey: true, ctrlKey: false,
    altKey: false, shiftKey: true, platform: "darwin"
  }), "Command+Shift+K");
  assert.equal(shortcutAccelerator({
    code: "KeyN", key: "n", metaKey: false, ctrlKey: false,
    altKey: false, shiftKey: false, platform: "darwin"
  }), null);
});

test("formats recent note open times", () => {
  const now = 1_000_000_000;
  assert.equal(formatOpenedAt(now - 30_000, now), "Opened just now");
  assert.equal(formatOpenedAt(now - 7_200_000, now), "Opened 2 hours ago");
  assert.equal(formatOpenedAt(undefined, now), null);
});

test("sorts notes by persisted open time then by path", () => {
  const files = [{ path: "Ray Notes/B.md" }, { path: "Ray Notes/A.md" }, { path: "Ray Notes/C.md" }];
  assert.deepEqual(
    sortNotePaths(files, { "Ray Notes/C.md": 10, "Ray Notes/B.md": 20 }).map((file) => file.path),
    ["Ray Notes/B.md", "Ray Notes/C.md", "Ray Notes/A.md"]
  );
  assert.deepEqual(
    sortNotePaths(files, { "C.md": 10, "B.md": 20 }, (file) => file.path.slice("Ray Notes/".length))
      .map((file) => file.path),
    ["Ray Notes/B.md", "Ray Notes/C.md", "Ray Notes/A.md"]
  );
});

test("stores note paths relative to the configured notes folder", () => {
  assert.equal(relativeNotePath("Ray Notes", "Ray Notes/Note A.md"), "Note A.md");
  assert.equal(relativeNotePath("Ray Notes", "Ray Notes/Projects/Note B.md"), "Projects/Note B.md");
});

test("defers overlay shortcuts while IME composition is settling", () => {
  assert.equal(isImeInteractionPending(true, false, 0, 1000), true);
  assert.equal(isImeInteractionPending(false, true, 0, 1000), true);
  assert.equal(isImeInteractionPending(false, false, 950, 1000), true);
  assert.equal(isImeInteractionPending(false, false, 800, 1000), false);
});

test("defers editor focus until IME composition has settled", () => {
  assert.equal(imeFocusDelay(true, 0, 1000), 160);
  assert.equal(imeFocusDelay(false, 950, 1000), 110);
  assert.equal(imeFocusDelay(false, 800, 1000), 0);
  assert.equal(imeFocusDelay(false, 0, 1000), 0);
});

test("opening the link popover cannot turn the selection into a task", () => {
  assert.equal(restoreUnexpectedTaskPrefix("Link", "- [ ] Link"), "Link");
  assert.equal(restoreUnexpectedTaskPrefix("- [ ] Existing", "- [ ] Existing"), "- [ ] Existing");
});

test("keeps additional reading-view blank lines measurable", () => {
  assert.deepEqual(extraBlankLineGaps("First\n\nSecond"), [0]);
  assert.deepEqual(extraBlankLineGaps("First\n\n\nSecond\n\n\n\nThird"), [1, 2]);
});
