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
  | { kind: "code"; lines: string[] }
  | { kind: "binary"; reason: "image" | "binary" }
  | { kind: "large"; lines: number | null }
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

/** Split file text into lines. NUL bytes and oversized text are not shown. */
export function previewFromText(text: string): Preview {
  if (text.includes("\u0000")) return { kind: "binary", reason: "binary" };
  if (text.length > PREVIEW_LIMITS.maxChars) return { kind: "large", lines: null };
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length > PREVIEW_LIMITS.maxLines) return { kind: "large", lines: lines.length };
  return { kind: "code", lines };
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

