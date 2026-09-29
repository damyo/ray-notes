import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { editorDecorations } from "../src/editor-extension.ts";

test("keeps a list quote aligned through lazy continuation lines", () => {
  const state = EditorState.create({
    doc: "- Parent\n  > Quote\ncontinued\ncontinued again\n\noutside"
  });
  const quoteLines: string[] = [];
  const cursor = editorDecorations(state).iter();
  while (cursor.value) {
    const classes = cursor.value.spec.attributes?.class ?? "";
    if (classes.includes("ray-notes-quote-depth")) {
      quoteLines.push(`${state.doc.lineAt(cursor.from).number}:${classes}`);
    }
    cursor.next();
  }
  assert.deepEqual(quoteLines, [
    "2:ray-notes-quote-depth ray-notes-quote-after-list",
    "3:ray-notes-quote-depth ray-notes-quote-after-list ray-notes-quote-lazy",
    "4:ray-notes-quote-depth ray-notes-quote-after-list ray-notes-quote-lazy"
  ]);
});

test("offsets quoted list continuations by their list level", () => {
  const state = EditorState.create({
    doc: "- First\n  > First quote\n\n\t1. Second\n\t   > Second quote\n\n\t\t- [ ] Third\n\t\t      > Third quote\n\n\t\t\t+ Fourth\n\t\t\t  > Fourth quote\n\n\t\t\t\t* Fifth\n\t\t\t\t  > Fifth quote"
  });
  const indents: string[] = [];
  const cursor = editorDecorations(state).iter();
  while (cursor.value) {
    const attributes = cursor.value.spec.attributes;
    if (attributes?.class?.includes("ray-notes-quote-after-list")) {
      indents.push(attributes.style?.match(/--ray-notes-quote-list-indent: ([\d.]+em)/)?.[1] ?? "");
    }
    cursor.next();
  }
  assert.deepEqual(indents, ["0em", "1em", "2em", "3em", "4em"]);
});
