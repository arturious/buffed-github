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
  | {
      kind: "code";
      language: string | null;
      tabSize: number;
      lines: string[];
      /** Parallel to `lines`. Entries are GitHub styling directives, unchecked. */
      directives: unknown[];
      sizeLabel: string | null;
    }
  | { kind: "binary"; reason: "image" | "binary"; sizeLabel: string | null }
  | { kind: "large"; lines: number | null; sizeLabel: string | null }
  | { kind: "error"; message: string };

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
const TOKEN_CLASS = /^pl-[a-z0-9-]+$/;
const LANGUAGE = /^[\w#+.\- ]{1,40}$/;
const SIZE_LABEL = /^[\d.,]+\s*(?:B|KB|MB|GB|Byte|Bytes)$/i;

export function isPreviewClick(event: PreviewClick): boolean {
  return (
    event.button === 0 &&
    event.altKey &&
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

export interface Segment {
  text: string;
  /** A GitHub prettylights class, or null for unhighlighted text. */
  cls: string | null;
}

/**
 * Split one source line into safe text segments. Directive classes are kept
 * only when they are a single `pl-*` token; everything else stays plain text.
 * Ranges are never trusted past the line, and overlaps are dropped.
 */
export function segmentsForLine(line: string, directives: unknown): Segment[] {
  const ranges: { start: number; end: number; cls: string }[] = [];
  if (Array.isArray(directives)) {
    for (const item of directives) {
      if (!Array.isArray(item) || item.length < 3) continue;
      const start = item[0];
      const end = item[1];
      const cls = item[2];
      if (typeof start !== "number" || typeof end !== "number") continue;
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
      if (typeof cls !== "string" || !TOKEN_CLASS.test(cls)) continue;
      if (start < 0 || end > line.length || start >= end) continue;
      ranges.push({ start, end, cls });
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Segment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) out.push({ text: line.slice(cursor, range.start), cls: null });
    out.push({ text: line.slice(range.start, range.end), cls: range.cls });
    cursor = range.end;
  }
  if (cursor < line.length || out.length === 0) out.push({ text: line.slice(cursor), cls: null });
  return out;
}

/**
 * Preview from the file's own bytes. Text is split into lines and returned as
 * strings; nothing here interprets markup. Images, octet-streams, and NUL
 * bytes are not text. Oversized text is refused before the dialog builds a row
 * per line.
 */
export function previewFromText(text: string, contentType: string | null): Preview {
  const type = (contentType ?? "").toLowerCase();
  if (type.startsWith("image/")) return { kind: "binary", reason: "image", sizeLabel: null };
  if (type.includes("octet-stream") || text.includes("\u0000")) return { kind: "binary", reason: "binary", sizeLabel: null };
  if (text.length > PREVIEW_LIMITS.maxChars) return { kind: "large", lines: null, sizeLabel: null };
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length > PREVIEW_LIMITS.maxLines) return { kind: "large", lines: lines.length, sizeLabel: null };
  return {
    kind: "code",
    language: null,
    tabSize: 2,
    lines,
    directives: lines.map(() => null),
    sizeLabel: null,
  };
}

/**
 * Lines GitHub copies into `#read-only-cursor-text-area` after the blob page
 * hydrates. The textarea itself is not in the fetched HTML. Returns null when
 * the array is absent or not a list of strings.
 */
export function rawLinesInHtml(html: string): string[] | null {
  const key = '"rawLines":';
  const at = html.indexOf(key);
  if (at < 0) return null;
  const start = html.indexOf("[", at + key.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
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
          const value = JSON.parse(html.slice(start, i + 1)) as unknown;
          if (!Array.isArray(value) || value.some((line) => typeof line !== "string")) return null;
          return value as string[];
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const EMBEDDED_START = '<script type="application/json" data-target="react-app.embeddedData">';

/** Read the preview from a blob page's HTML. Never returns markup to insert. */
export function interpretPreview(html: string): Preview {
  if (html.length > PREVIEW_LIMITS.maxHtmlChars) return { kind: "large", lines: null, sizeLabel: null };
  const embedded = embeddedPayload(html);
  if (!embedded) return { kind: "error", message: "Couldn't read a preview from GitHub." };
  const payload = record(record(embedded)?.payload);
  const blob = record(record(payload?.codeViewBlobLayoutRoute)?.blob);
  if (!payload || !blob) return { kind: "error", message: "Couldn't read a preview from GitHub." };

  const sizeLabel = cleanSizeLabel(record(blob.headerInfo)?.blobSize);
  const hintedLines = lineCount(record(record(blob.headerInfo)?.lineInfo)?.truncatedLoc);
  const styled = record(payload["codeViewBlobLayoutRoute.StyledBlob"]);

  if (blob.image === true) return { kind: "binary", reason: "image", sizeLabel };
  if (blob.viewable === false || (blob.renderImageOrRaw === true && blob.viewable !== true)) {
    return { kind: "binary", reason: "binary", sizeLabel };
  }
  if (blob.large === true) return { kind: "large", lines: hintedLines, sizeLabel };

  const raw = normalizeLines(styled?.rawLines);
  if (raw === null) {
    const huge =
      blob.truncated === true ||
      (sizeBytes(sizeLabel) ?? 0) > PREVIEW_LIMITS.maxChars ||
      (hintedLines ?? 0) > PREVIEW_LIMITS.maxLines;
    if (huge) return { kind: "large", lines: hintedLines, sizeLabel };
    return { kind: "error", message: "GitHub didn't include this file's source." };
  }
  if (raw === "too-big" || blob.truncated === true) {
    return {
      kind: "large",
      lines: raw === "too-big" ? arrayLength(styled?.rawLines) : raw.length,
      sizeLabel,
    };
  }
  if (raw.some((line) => line.includes("\u0000"))) return { kind: "binary", reason: "binary", sizeLabel };

  const directives = Array.isArray(styled?.stylingDirectives) ? styled.stylingDirectives : raw.map(() => null);
  return {
    kind: "code",
    language: cleanLanguage(blob.language),
    tabSize: tabSizeOf(blob.tabSize),
    lines: raw,
    directives,
    sizeLabel,
  };
}

function embeddedPayload(html: string): unknown {
  const start = html.indexOf(EMBEDDED_START);
  if (start < 0) return null;
  const jsonStart = start + EMBEDDED_START.length;
  const end = html.indexOf("</script>", jsonStart);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(jsonStart, end)) as unknown;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeLines(value: unknown): string[] | "too-big" | null {
  if (!Array.isArray(value)) return null;
  if (value.length > PREVIEW_LIMITS.maxLines) return "too-big";
  const lines: string[] = [];
  let chars = 0;
  for (const line of value) {
    if (typeof line !== "string") return null;
    chars += line.length;
    if (chars > PREVIEW_LIMITS.maxChars) return "too-big";
    lines.push(line);
  }
  return lines;
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function cleanLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return LANGUAGE.test(trimmed) ? trimmed : null;
}

function cleanSizeLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > 24 || !SIZE_LABEL.test(trimmed)) return null;
  return trimmed;
}

function sizeBytes(label: string | null): number | null {
  if (!label) return null;
  const match = label.match(/^([\d.,]+)\s*(B|KB|MB|GB|Byte|Bytes)$/i);
  if (!match?.[1] || !match[2]) return null;
  const n = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const unit = match[2].toUpperCase();
  const mult = unit === "B" || unit === "BYTE" || unit === "BYTES" ? 1 : unit === "KB" ? 1024 : unit === "MB" ? 1024 * 1024 : 1024 * 1024 * 1024;
  return n * mult;
}

function lineCount(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = typeof value === "number" ? value : Number(value.replace(/,/g, ""));
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function tabSizeOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 16) return 2;
  return value;
}
