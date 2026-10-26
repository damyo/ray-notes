import { RangeSetBuilder, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, Direction, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

const listMarker = /^(\s*)([-+*]|\d+[.)])(\s+)(?:\[[^\r\n]\](\s+))?/;
const quotePrefix = /^(\s*)((?:>\s*)+)/;

function indentColumns(value: string): number {
  return value.replace(/\t/g, "    ").length;
}

export function editorDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let activeList: { contentIndent: number; nesting: number; contentFrom: number } | null = null;
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
        contentFrom: line.from + marker[0].length
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
        builder.add(line.from, line.from, Decoration.line({
          attributes: {
            class: "ray-notes-list-continuation",
            "data-ray-notes-list-content-from": String(activeList.contentFrom)
          }
        }));
      }
    }

    if (quote && continuedQuote?.afterList) {
      const markerFrom = line.from + quote[1].length;
      builder.add(markerFrom, markerFrom + 1, Decoration.mark({ class: "ray-notes-quote-marker" }));
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

type ListAlignmentChange = { from: number; offset: number | undefined };
const listAlignmentEffect = StateEffect.define<ListAlignmentChange[]>();

export const listAlignmentOffsets = StateField.define<ReadonlyMap<number, number>>({
  create: () => new Map(),
  update(offsets, transaction) {
    if (transaction.docChanged) offsets = new Map();
    for (const effect of transaction.effects) {
      if (!effect.is(listAlignmentEffect)) continue;
      const next = new Map(offsets);
      for (const { from, offset } of effect.value) {
        if (offset === undefined) next.delete(from);
        else next.set(from, offset);
      }
      offsets = next;
    }
    return offsets;
  },
  provide: field => EditorView.decorations.from(field, offsets => Decoration.set(
    Array.from(offsets, ([from, offset]) => Decoration.line({ attributes: {
      style: `--ray-notes-list-continuation-offset: ${offset}px`
    } }).range(from)), true
  ))
});

export class ListContinuationAlignment {
  private readonly widths = new Map<number, number>();
  private characterWidth = 0;
  private destroyed = false;
  private readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    this.schedule();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || this.characterWidth !== this.view.defaultCharacterWidth) this.widths.clear();
    if (update.docChanged || update.viewportChanged || update.geometryChanged
      || update.selectionSet || update.focusChanged) this.schedule();
  }

  destroy(): void {
    this.destroyed = true;
  }

  private schedule(): void {
    this.view.requestMeasure({
      key: this,
      read: () => this.measure(),
      write: (changes) => {
        const doc = this.view.state.doc;
        // CodeMirror forbids transactions inside its measurement/update cycle.
        queueMicrotask(() => {
          if (this.destroyed || this.view.state.doc !== doc) return;
          const offsets = this.view.state.field(listAlignmentOffsets);
          if (changes.some(({ from, offset }) => offsets.get(from) !== offset)) {
            this.view.dispatch({ effects: listAlignmentEffect.of(changes) });
          }
        });
      }
    });
  }

  private contentInset(element: HTMLElement, contentFrom: number): number | undefined {
    const { view } = this;
    const caret = view.coordsAtPos(contentFrom, 1);
    if (!caret) return undefined;
    const bounds = element.getBoundingClientRect();
    const width = (view.textDirectionAt(contentFrom) === Direction.RTL
      ? bounds.right - caret.right : caret.left - bounds.left) / view.scaleX;
    return Number.isFinite(width) && width >= 0 ? width : undefined;
  }

  private measure(): ListAlignmentChange[] {
    const { view } = this;
    if (!view.dom.ownerDocument.body.matches(".ray-notes-window.ray-notes-raycast-style")) return [];
    this.characterWidth = view.defaultCharacterWidth;
    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>(":scope > .cm-line.HyperMD-list-line"));
    const elements = new Map<number, HTMLElement>();
    for (const element of lines) elements.set(view.state.doc.lineAt(view.posAtDOM(element)).from, element);
    for (const [from, element] of elements) {
      const marker = view.state.doc.lineAt(from).text.match(listMarker);
      if (!marker || element.classList.contains("ray-notes-quote-depth")) continue;
      const contentFrom = from + marker[0].length;
      const width = this.contentInset(element, contentFrom);
      if (width !== undefined) this.widths.set(contentFrom, width);
    }
    return lines.filter(element => element.classList.contains("ray-notes-list-continuation")
      && !element.classList.contains("ray-notes-quote-depth"))
      .map(element => {
        const line = view.state.doc.lineAt(view.posAtDOM(element));
        const contentFrom = line.from + (line.text.match(/^\s*/)?.[0].length ?? 0);
        const currentInset = this.contentInset(element, contentFrom);
        // shortcut: Off-screen parents fall back to native indentation until their first measurement.
        const parentInset = this.widths.get(Number(element.dataset.rayNotesListContentFrom));
        return { from: line.from, offset: currentInset !== undefined && parentInset !== undefined
          ? parentInset - currentInset : undefined };
      });
  }
}

export const rayNotesEditorExtension = [
  rayNotesEditorDecorationsExtension,
  listAlignmentOffsets,
  ViewPlugin.fromClass(ListContinuationAlignment),
  EditorView.scrollMargins.of(() => ({ top: 60, bottom: 70 }))
];
