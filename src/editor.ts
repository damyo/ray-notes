export interface CursorPosition {
  line: number;
  ch: number;
}

export function advancePosition(start: CursorPosition, text: string): CursorPosition {
  const lines = text.split("\n");
  return lines.length === 1
    ? { line: start.line, ch: start.ch + text.length }
    : { line: start.line + lines.length - 1, ch: lines[lines.length - 1].length };
}

export interface ToggleWrapEdit {
  from: number;
  to: number;
  text: string;
  selectionFrom: number;
  selectionTo: number;
}

export function toggleWrapEdit(
  document: string,
  from: number,
  to: number,
  before: string,
  after = before
): ToggleWrapEdit {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const selection = document.slice(start, end);
  const wrappedOutside = start >= before.length
    && document.slice(start - before.length, start) === before
    && document.slice(end, end + after.length) === after;
  if (wrappedOutside) {
    const replaceFrom = start - before.length;
    return {
      from: replaceFrom,
      to: end + after.length,
      text: selection,
      selectionFrom: replaceFrom,
      selectionTo: replaceFrom + selection.length
    };
  }

  const wrappedSelection = selection.length >= before.length + after.length
    && selection.startsWith(before)
    && selection.endsWith(after);
  if (wrappedSelection) {
    const inner = selection.slice(before.length, selection.length - after.length);
    return {
      from: start,
      to: end,
      text: inner,
      selectionFrom: start,
      selectionTo: start + inner.length
    };
  }

  return {
    from: start,
    to: end,
    text: `${before}${selection}${after}`,
    selectionFrom: start + before.length,
    selectionTo: start + before.length + selection.length
  };
}

export function headingEdit(line: string, cursorCh: number, level: number): {
  prefix: string;
  replaceEnd: number;
  cursorCh: number;
} {
  const current = line.match(/^#{1,6}\s+/)?.[0] ?? "";
  const prefix = `${"#".repeat(level)} `;
  return {
    prefix,
    replaceEnd: current.length,
    cursorCh: Math.max(prefix.length, cursorCh - current.length + prefix.length)
  };
}

export function codeFenceOpeningLine(lines: string[], cursorLine: number): number | null {
  let opening: number | null = null;
  for (let line = 0; line <= cursorLine; line += 1) {
    if (!/^\s*```/.test(lines[line] ?? "")) continue;
    opening = opening === null ? line : null;
  }
  return opening;
}

export function calloutHeaderLine(lines: string[], cursorLine: number): number | null {
  for (let line = cursorLine; line >= 0; line -= 1) {
    const value = lines[line] ?? "";
    if (!/^\s*>/.test(value)) break;
    if (/\[![^\]]+\]/.test(value)) return line;
  }
  return null;
}

export function isImeInteractionPending(
  isComposing: boolean,
  keyCode: number,
  compositionEndedAt: number,
  now: number
): boolean {
  const sinceCompositionEnd = now - compositionEndedAt;
  return isComposing
    || keyCode === 229
    || (compositionEndedAt > 0 && sinceCompositionEnd >= 0 && sinceCompositionEnd < 120);
}

export function imeFocusDelay(isComposing: boolean, compositionEndedAt: number, now: number): number {
  if (isComposing) return 160;
  if (compositionEndedAt <= 0) return 0;
  return Math.max(0, 160 - (now - compositionEndedAt));
}

export function restoreUnexpectedTaskPrefix(before: string, after: string): string {
  return after === `- [ ] ${before}` ? before : after;
}

export function extraBlankLineGaps(markdown: string): number[] {
  return Array.from(markdown.matchAll(/\n(?:[\t ]*\n)+/g), ({ 0: gap }) =>
    Math.max(0, gap.split("\n").length - 3)
  );
}
