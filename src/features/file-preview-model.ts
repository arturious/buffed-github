// Pure decisions for the file preview: which click to take, which link is a
// file, and what GitHub's blob page means. No DOM, so nothing here can run
// fetched markup. The dialog turns the result into text nodes.

export const PREVIEW_LIMITS = {
  /** Above this, building a line of DOM nodes per row is not worth it. */
  maxLines: 12_000,
  /** File text. package-lock.json on this repo is under this. */
  maxChars: 256 * 1024,
  /** Blob HTML larger than this is treated as a large file and not parsed. */
  maxHtmlChars: 8_000_000,
};

/** A repository file link in the file table. `pathname` stays encoded for fetch. */
export interface RepoFile {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  pathname: string;
}

export type Preview =
  | { kind: "code"; lines: string[]; directives: unknown[]; tabSize: number }
  | { kind: "binary"; reason: "image" | "binary" }
  | { kind: "large"; lines: number | null }
  | { kind: "error"; message: string };

export interface Segment {
  text: string;
  /** A GitHub prettylights class, or null for plain text. */
  cls: string | null;
}

export interface PreviewClick {
  button: number;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  /** 0 for a keyboard-synthesized click. A real primary click is at least 1. */
  detail: number;
}

const BLOB_PATH = /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;

export function isPreviewClick(event: PreviewClick): boolean {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    event.detail >= 1
  );
}

/** Blob link on this origin, or null for folders, other hosts, and junk hrefs. */
export function fileFromHref(href: string, base: string): RepoFile | null {
  let url: URL;
  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.origin !== baseUrl.origin) return null;
  const match = url.pathname.match(BLOB_PATH);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  const ref = match[3];
  const path = match[4];
  if (!owner || !repo || !ref || !path) return null;
  try {
    return {
      owner: decodeURIComponent(owner),
      repo: decodeURIComponent(repo),
      ref: decodeURIComponent(ref),
      path: decodeURIComponent(path),
      pathname: url.pathname,
    };
  } catch {
    return null;
  }
}

const TOKEN_CLASS = /^pl-[a-z0-9-]+$/;

/** Split file text into lines. NUL bytes and oversized text are not shown. */
export function previewFromText(text: string): Preview {
  if (text.includes("\u0000")) return { kind: "binary", reason: "binary" };
  if (text.length > PREVIEW_LIMITS.maxChars) return { kind: "large", lines: null };
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return previewFromLines(lines, [], 4);
}

export function previewFromLines(lines: string[], directives: unknown[], tabSize: number): Preview {
  if (lines.some((line) => line.includes("\u0000"))) return { kind: "binary", reason: "binary" };
  let chars = 0;
  for (const line of lines) {
    chars += line.length;
    if (chars > PREVIEW_LIMITS.maxChars) return { kind: "large", lines: lines.length };
  }
  if (lines.length > PREVIEW_LIMITS.maxLines) return { kind: "large", lines: lines.length };
  const tab = Number.isInteger(tabSize) && tabSize >= 1 && tabSize <= 16 ? tabSize : 4;
  return { kind: "code", lines, directives: lines.map((_, index) => directives[index] ?? null), tabSize: tab };
}

/**
 * Token slices for one line. The innermost GitHub range wins, which is how
 * overlapping `stylingDirectives` are painted. The pieces concatenate to `line`.
 */
export function segmentsForLine(line: string, directives: unknown): Segment[] {
  const ranges: { start: number; end: number; cls: string; order: number }[] = [];
  if (Array.isArray(directives)) {
    directives.forEach((item, order) => {
      if (!Array.isArray(item) || item.length < 3) return;
      const start = item[0];
      const end = item[1];
      const cls = item[2];
      if (typeof start !== "number" || typeof end !== "number" || typeof cls !== "string") return;
      if (!Number.isInteger(start) || !Number.isInteger(end) || !TOKEN_CLASS.test(cls)) return;
      if (start < 0 || end > line.length || start >= end) return;
      ranges.push({ start, end, cls, order });
    });
  }
  const clsAt = (index: number): string | null => {
    let best: { len: number; order: number; cls: string } | null = null;
    for (const range of ranges) {
      if (index < range.start || index >= range.end) continue;
      const len = range.end - range.start;
      if (!best || len < best.len || (len === best.len && range.order > best.order)) {
        best = { len, order: range.order, cls: range.cls };
      }
    }
    return best?.cls ?? null;
  };
  const out: Segment[] = [];
  let buffer = "";
  let current: string | null = null;
  for (let index = 0; index < line.length; index++) {
    const cls = clsAt(index);
    if (index > 0 && cls !== current) {
      out.push({ text: buffer, cls: current });
      buffer = "";
    }
    current = cls;
    buffer += line[index] ?? "";
  }
  if (buffer.length > 0 || out.length === 0) out.push({ text: buffer, cls: current });
  return out;
}

/** How many leading spaces or tabs to mark. The characters themselves stay in the line. */
export function indentLength(line: string): number {
  let index = 0;
  while (index < line.length && (line[index] === " " || line[index] === "\t")) index += 1;
  return index;
}

/**
 * Lines GitHub copies into `#read-only-cursor-text-area` after the blob page
 * hydrates. The textarea itself is not in the fetched HTML. Returns null when
 * the array is absent or not a list of strings.
 */
function jsonArrayAfter(html: string, key: string, from = 0): unknown[] | null {
  const at = html.indexOf(key, from);
  if (at < 0) return null;
  const start = html.indexOf("[", at + key.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          const value = JSON.parse(html.slice(start, index + 1)) as unknown;
          return Array.isArray(value) ? value : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function rawLinesInHtml(html: string): string[] | null {
  const value = jsonArrayAfter(html, '"rawLines":');
  if (!value || value.some((line) => typeof line !== "string")) return null;
  return value as string[];
}

export function tabSizeInHtml(html: string): number {
  const tabMatch = html.match(/"tabSize":(\d+)/);
  const parsed = tabMatch ? Number(tabMatch[1]) : 4;
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 16 ? parsed : 4;
}

/** `rawLines`, the parallel `stylingDirectives`, and `tabSize` from one blob page. */
export function highlightedSource(html: string): { lines: string[]; directives: unknown[]; tabSize: number } | null {
  const lines = rawLinesInHtml(html);
  if (!lines) return null;
  const at = html.indexOf('"rawLines":');
  const styling = jsonArrayAfter(html, '"stylingDirectives":', at);
  return {
    lines,
    directives: lines.map((_, index) => styling?.[index] ?? null),
    tabSize: tabSizeInHtml(html),
  };
}

/**
 * Token ranges from a server-rendered code cell. Only `pl-*` classes are kept.
 * Nested tokens use the innermost class, same as GitHub's paint order.
 */
export function directivesFromCodeCell(cell: ParentNode): { line: string; directives: unknown[] } {
  let line = "";
  const directives: unknown[] = [];
  const visit = (node: Node, cls: string | null): void => {
    if (node.nodeType === 3) {
      const text = node.nodeValue ?? "";
      if (cls && text.length > 0) directives.push([line.length, line.length + text.length, cls]);
      line += text;
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    let next = cls;
    const className = element.getAttribute("class");
    if (className) {
      for (const name of className.split(/\s+/)) {
        if (TOKEN_CLASS.test(name)) {
          next = name;
          break;
        }
      }
    }
    const children = element.childNodes;
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      if (child) visit(child, next);
    }
  };
  visit(cell, null);
  return { line, directives };
}

