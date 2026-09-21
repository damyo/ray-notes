export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function pointInsideBounds(
  point: { x: number; y: number },
  bounds: ScreenBounds,
  margin = 0
): boolean {
  return point.x >= bounds.x - margin
    && point.x < bounds.x + bounds.width + margin
    && point.y >= bounds.y - margin
    && point.y < bounds.y + bounds.height + margin;
}

export function draggedWindowBounds(
  bounds: ScreenBounds,
  start: { x: number; y: number },
  current: { x: number; y: number },
  threshold = 3
): ScreenBounds | null {
  const x = current.x - start.x;
  const y = current.y - start.y;
  return Math.abs(x) + Math.abs(y) < threshold ? null : {
    ...bounds,
    x: bounds.x + x,
    y: bounds.y + y
  };
}

export function fittedRestoreBounds(
  minimal: ScreenBounds,
  normal: Pick<ScreenBounds, "width" | "height">,
  workArea: ScreenBounds
): ScreenBounds {
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;
  const x = minimal.x + normal.width > right
    ? minimal.x + minimal.width - normal.width
    : minimal.x;
  const y = minimal.y + normal.height > bottom
    ? minimal.y + minimal.height - normal.height
    : minimal.y;
  return {
    x: Math.min(Math.max(workArea.x, workArea.x + workArea.width - normal.width), Math.max(workArea.x, x)),
    y: Math.min(Math.max(workArea.y, workArea.y + workArea.height - normal.height), Math.max(workArea.y, y)),
    width: normal.width,
    height: normal.height
  };
}

export function usesNewWindowModifier(event: { altKey: boolean }): boolean {
  return event.altKey;
}

export function shouldHideWindowOnEscape(input: {
  key: string;
  hasModifier: boolean;
  isComposing: boolean;
  hasPluginOverlay: boolean;
  hasObsidianOverlay: boolean;
}): boolean {
  return input.key === "Escape"
    && !input.hasModifier
    && !input.isComposing
    && !input.hasPluginOverlay
    && !input.hasObsidianOverlay;
}

export function shortcutAccelerator(input: {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  platform: NodeJS.Platform;
}): string | null {
  const modifiers: string[] = [];
  if (input.metaKey) modifiers.push(input.platform === "darwin" ? "Command" : "Super");
  if (input.ctrlKey) modifiers.push("Control");
  if (input.altKey) modifiers.push("Alt");
  if (input.shiftKey) modifiers.push("Shift");
  if (!modifiers.length) return null;

  let key: string | null = null;
  if (/^Key[A-Z]$/.test(input.code)) key = input.code.slice(3);
  else if (/^Digit\d$/.test(input.code)) key = input.code.slice(5);
  else if (/^F(?:[1-9]|1\d|2[0-4])$/.test(input.code)) key = input.code;
  else {
    key = ({
      Space: "Space",
      Enter: "Enter",
      Tab: "Tab",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown"
    } as Record<string, string>)[input.code] ?? null;
  }
  return key ? [...modifiers, key].join("+") : null;
}

export function formatOpenedAt(timestamp: number | undefined, now = Date.now()): string | null {
  if (!timestamp) return null;
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "Opened just now";
  if (elapsed < 3_600_000) return `Opened ${Math.floor(elapsed / 60_000)} minutes ago`;
  if (elapsed < 86_400_000) return `Opened ${Math.floor(elapsed / 3_600_000)} hours ago`;
  return `Opened ${Math.floor(elapsed / 86_400_000)} days ago`;
}

export function sortNotePaths<T extends { path: string }>(
  files: T[],
  lastOpened: Record<string, number>,
  key: (file: T) => string = (file) => file.path
): T[] {
  return [...files].sort((a, b) => (lastOpened[key(b)] ?? 0) - (lastOpened[key(a)] ?? 0)
    || a.path.localeCompare(b.path, undefined, { sensitivity: "base", numeric: true }));
}

export function relativeNotePath(folder: string, path: string): string {
  const normalizedFolder = folder.replace(/^\/+|\/+$/g, "");
  const normalizedPath = path.replace(/^\/+|\/+$/g, "");
  const prefix = `${normalizedFolder}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath;
}
