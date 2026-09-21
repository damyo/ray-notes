export function titleFromFirstLine(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*(?:[-*+] |\d+[.)] )(?:\[[ xX]\]\s*)?/, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~`]/g, "")
    .trim() || "Untitled";
}

export function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|#[\]^]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
}
