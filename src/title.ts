export function titleFromFirstLine(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*(?:[-*+] |\d+[.)] )(?:\[[ xX]\]\s*)?/, "")
    .replace(/!\[\[[^\]]+\]\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~`]/g, "")
    .trim() || "Untitled";
}

export function titleFromLines(lines: string[]): string {
  let inFrontmatter = lines[0]?.trim() === "---";
  let inFence = false;
  let codeTitle = "";
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (inFrontmatter) {
      if (index > 0 && trimmed === "---") inFrontmatter = false;
      continue;
    }
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      if (!codeTitle) codeTitle = plainCodeLine(line);
      continue;
    }
    if (!trimmed || /^\s*>\s*\[![^\]]+\][+-]?(?:\s+.*)?$/i.test(line)) continue;
    const title = titleFromFirstLine(line);
    if (title !== "Untitled") return title;
  }
  return codeTitle || "Untitled";
}

function plainCodeLine(line: string): string {
  return line.trim()
    .replace(/^\/\/[\s]*/, "")
    .trim();
}

export function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|#[\]^]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
}

export function withHeadingTitle(content: string, title: string): string {
  const frontmatter = content.match(/^---\n[\s\S]*?\n---(?:\n|$)/)?.[0] ?? "";
  const body = content.slice(frontmatter.length);
  const firstLine = body.split("\n").find((line) => line.trim()) ?? "";
  if (/^\s*#\s+\S/.test(firstLine)) return content;
  const separator = frontmatter && !frontmatter.endsWith("\n") ? "\n" : "";
  return `${frontmatter}${separator}# ${title}\n\n${body.replace(/^\n+/, "")}`;
}

export function plainNotePreview(content: string): { title: string; body: string } {
  const lines = content.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, "").split("\n");
  const title = titleFromLines(lines);
  let inFence = false;
  const body = lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return "";
      }
      return inFence ? plainCodeLine(line) : titleFromFirstLine(line);
    })
    .filter((line) => line !== "Untitled" && line !== title)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { title, body };
}
