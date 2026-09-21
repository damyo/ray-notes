import assert from "node:assert/strict";
import test from "node:test";
import { safeFileName, titleFromFirstLine } from "../src/title.ts";

test("derives a plain title from formatted first lines", () => {
  assert.equal(titleFromFirstLine("# **Ray Notes**"), "Ray Notes");
  assert.equal(titleFromFirstLine("> [[Notes/Ray|Ray Notes]]"), "Ray Notes");
  assert.equal(titleFromFirstLine(""), "Untitled");
  assert.equal(safeFileName('Ray / Notes: "Draft"'), "Ray Notes Draft");
});
