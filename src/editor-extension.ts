import { RangeSetBuilder, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

const listMarker = /^(\s*)([-+*]|\d+[.)])(\s+)(?:\[[ xX-]\](\s+))?/;
const quotePrefix = /^(\s*)((?:>\s*)+)/;

function indentColumns(value: string): number {
  return value.replace(/\t/g, "    ").length;
}

export function editorDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let activeList: { contentIndent: number; nesting: number; wideMarker: boolean } | null = null;
  let continuedQuote: { depth: number; afterList: boolean; listIndent: number } | null = null;
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const marker = line.text.match(listMarker);
    const quote = line.text.match(quotePrefix);
    const startsBlock = /^ {0,3}(?:#{1,6}(?:\s|$)|`{3,}|~{3,}|(?:[-*_]\s*){3,}$)/.test(line.text);
    const lazyQuote = !quote && continuedQuote !== null
      && line.text.trim() !== "" && !marker && !startsBlock;

    if (quote) {
      continuedQuote = {
        depth: (quote[2].match(/>/g) ?? []).length,
        afterList: activeList !== null,
        listIndent: activeList ? Math.ceil(activeList.nesting / 4) : 0
      };
    } else if (!lazyQuote) {
      continuedQuote = null;
    }

    if (continuedQuote) {
      const depth = continuedQuote.depth;
      const offset = (depth - 1) * 14.5;
      const activeOffset = 0;
      const markerOffset = (depth - 1) * 9;
      const whitespaceOffset = quote
        ? indentColumns(quote[0].replace(/>/g, "")) * 3.5
        : 0;
      builder.add(line.from, line.from, Decoration.line({
        attributes: {
          class: `ray-notes-quote-depth${continuedQuote.afterList ? " ray-notes-quote-after-list" : ""}${lazyQuote ? " ray-notes-quote-lazy" : ""}`,
          style: [
            `--ray-notes-quote-depth: ${depth}`,
            `--ray-notes-quote-list-indent: ${continuedQuote.listIndent}em`,
            `--ray-notes-quote-offset: ${offset}px`,
            `--ray-notes-quote-active-offset: ${activeOffset}px`,
            `--ray-notes-quote-marker-offset: ${markerOffset}px`,
            `--ray-notes-quote-whitespace-offset: ${whitespaceOffset}px`,
            `--ray-notes-quote-hidden-offset: -${markerOffset + whitespaceOffset}px`
          ].join("; ")
        }
      }));
    }

    if (marker) {
      const task = marker[4] !== undefined;
      const nesting = indentColumns(marker[1]);
      activeList = {
        contentIndent: nesting + marker[2].length + indentColumns(marker[3])
          + (task ? 3 + indentColumns(marker[4]) : 0),
        nesting,
        wideMarker: task || /^\d/.test(marker[2])
      };
    } else if (line.text.trim() === "") {
      activeList = null;
      if (line.text === "") {
        builder.add(line.from, line.from, Decoration.line({
          attributes: { class: "ray-notes-blank-line" }
        }));
      }
    } else if (activeList) {
      const leading = indentColumns(line.text.match(/^\s*/)?.[0] ?? "");
      if (leading < activeList.contentIndent) {
        activeList = null;
      } else {
        const nestedOffset = Math.floor(activeList.nesting / 2) * 14
          - Math.max(0, Math.floor((activeList.nesting - 4) / 4)) * 14;
        const axisCorrection = activeList.wideMarker
          ? (activeList.nesting ? -2.5 : 4)
          : (activeList.nesting ? -1.5 : 5);
        const sourceIndent = leading * 0.25;
        builder.add(line.from, line.from, Decoration.line({
          attributes: {
            class: "ray-notes-list-continuation",
            style: [
              `--ray-notes-list-continuation-padding: calc(2em + ${nestedOffset + axisCorrection - 12}px)`,
              `--ray-notes-list-continuation-indent: -${sourceIndent}em`
            ].join("; ")
          }
        }));
      }
    }
  }

  return builder.finish();
}

export const rayNotesEditorDecorationsExtension = StateField.define<DecorationSet>({
  create: editorDecorations,
  update(decorations, transaction) {
    return transaction.docChanged
      ? editorDecorations(transaction.state)
      : decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field)
});

export const rayNotesEditorExtension = [
  rayNotesEditorDecorationsExtension,
  EditorView.scrollMargins.of(() => ({ top: 60, bottom: 70 }))
];
