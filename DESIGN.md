---
version: 1
name: Ray Notes
description: A compact, keyboard-first Markdown editor inspired by Raycast Notes while preserving Obsidian's editor and file model.
---

# Ray Notes Design System

## Product Principles

- The editor is the primary surface; chrome stays quiet until the pointer enters the window.
- One note and one overlay are visible at a time.
- Keyboard shortcuts, tooltips, and action rows use Raycast-compatible labels.
- Raycast styling is scoped to `body.ray-notes-window` and never changes the main Obsidian window.
- Obsidian remains responsible for Markdown rendering, editing, accessibility, and file behavior.

## Visual Direction

Raycast Notes is the primary reference. The visual thesis is a warm charcoal macOS material, quiet typography, and compact controls floating over one continuous editor surface. Depth comes from surface contrast and macOS vibrancy rather than decorative gradients or heavy shadows.

## Tokens

### Color

- Canvas: `#111113` opaque, warm charcoal `rgba(28, 26, 27, 0.48)` over native `under-window` vibrancy and `32px` backdrop blur
- Canvas deep: `#0d0d0e`
- Surface: `#151517`
- Surface elevated: `#19191b`
- Primary text: `#f4f4f6`
- Secondary text: `#9c9c9f`
- Faint text: `#68686c`
- Hairline: `rgba(255, 255, 255, 0.08)`
- Hairline strong: `rgba(255, 255, 255, 0.15)`
- Hover: `rgba(255, 255, 255, 0.08)`
- Brand/action red: `#ff6161`
- Link red: `#ff6161`

### Typography

- Stack: `Inter`, `-apple-system`, `BlinkMacSystemFont`, `SF Pro Text`, `sans-serif`
- Features: `"calt", "kern", "liga", "ss03"`
- Editor body: `16px / 1.6 / 400`
- Toolbar title: `13px / 600`
- Action row: `14px / 600`
- Heading scale: `1.65em`, `1.38em`, `1.16em`

### Shape and Spacing

- Toolbar button: `30px`, `6px` radius
- Raycast top bar: `30px` height
- Raycast bottom bar: `38px` height
- Action row: `40px` minimum height, `7px` radius
- Input and small popover: `8–12px` radius
- Large overlay: `16px` radius
- Keycap: `22–24px` height, `6px` radius
- Border: `1px` hairline

## Surfaces

1. Canvas: editor and window background
2. Surface: toolbars and passive overlays
3. Elevated surface: inputs, selected rows, code, and tags
4. Floating surface: Action Panel, Browse Notes, Heading, Link, and tooltips

Only one floating surface may be open at a time.

## Window Appearance

- `Raycast appearance` is enabled by default and applies only scoped CSS variables and component rules.
- Native translucency is temporarily disabled while its Electron compositing behavior is investigated. The stable preset uses an opaque canvas and must not leak vibrancy into callout surfaces.
- Do not lower whole-window opacity as a fallback because it reveals a sharp desktop image and fades the editor content.
- Disabling translucency removes native vibrancy and restores an opaque canvas.
- Disabling Raycast appearance restores the active Obsidian theme inside Ray Notes while preserving the minimal window layout.

## Editor

- Keep the title derived from the first meaningful content line; do not duplicate it in the document.
- Preserve Obsidian's Markdown semantics and editing engine.
- Use the same red for links, checked tasks, and blockquote rules, with neutral surfaces for inline code and tags.
- Preserve each callout type's semantic background color; only refine its saturation, border, radius, and spacing.

## Chrome

- Top toolbar: traffic lights, centered title, Action Panel, Browse Notes, Create Note.
- Bottom toolbar: formatting controls only, centered and horizontally scrollable.
- Keep both toolbars outside the document scroller so its scrollbar starts below the top bar and ends above the bottom bar.
- Inactive state: hide top actions, dim title and bottom toolbar.
- Active state: no circular button fill by default; hover uses one surface step.

## Overlays

- Action Panel and Browse Notes use the same floating surface, border, radius, and selected-row treatment.
- Tooltips use compact text and physical-key-style keycaps.
- Link and Heading popovers stay close to their trigger or selection.
- DOM overlays must remain inside the Ray Notes window; do not imitate native behavior that Electron cannot safely provide.

## Do

- Scope every visual override to Ray Notes.
- Prefer Obsidian APIs and native Electron effects over custom infrastructure.
- Keep contrast sufficient when translucency is enabled.
- Honor reduced-motion preferences.

## Do Not

- Do not override the Vault's Obsidian theme globally.
- Do not replace `MarkdownView` or CodeMirror.
- Do not use whole-window opacity; it fades content and bypasses the intended blurred material.
- Do not add decorative gradients, glass cards, or multiple competing accent colors.
- Do not expose a setting for every token; maintain one coherent preset plus the translucency toggle.
