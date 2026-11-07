// Click a file in a repo's file table to preview it in a dialog instead of
// navigating. Enter opens the file, Escape closes the dialog. Folders expanded in place stay expanded, and
// the page is not scrolled. The file text is read from the same-origin blob
// page and drawn as text nodes. Fetched HTML is parsed, never inserted, and
// its scripts are not run.
import type { Feature } from "../feature";
import css from "./file-preview.css";
import {
  PREVIEW_LIMITS,
  fileFromHref,
  isPreviewClick,
  directivesFromCodeCell,
  highlightedSource,
  indentLength,
  previewFromLines,
  previewFromText,
  segmentsForLine,
  tabSizeInHtml,
  type Preview,
  type RepoFile,
} from "./file-preview-model";

const TABLE = 'table[aria-labelledby="folders-and-files"]';

interface Shell {
  root: HTMLElement;
  dialog: HTMLElement;
  body: HTMLElement;
  status: HTMLElement;
  href: string;
}

let generation = 0;
let currentAbort: AbortController | null = null;
let shell: Shell | null = null;
let opener: HTMLElement | null = null;
let pointerDownOnBackdrop = false;

interface BlobReply {
  ok?: boolean;
  html?: string;
  status?: number;
}

function extensionRuntime(): { sendMessage(message: unknown): Promise<unknown> } | null {
  const runtime = (globalThis as unknown as { browser?: typeof browser }).browser?.runtime;
  if (!runtime?.sendMessage) return null;
  return runtime;
}

function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  return name || path;
}

function groupNumber(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function focusable(dialog: HTMLElement): HTMLElement[] {
  const nodes = dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex='0']");
  return [...nodes].filter((node) => !node.hasAttribute("disabled") && node.closest("[hidden]") === null);
}

/** Only a click on the file link itself. The rest of the row is left alone. */
function linkFromTarget(target: Element): HTMLAnchorElement | null {
  if (!target.closest(TABLE)) return null;
  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (!link || !fileFromHref(link.href, location.href)) return null;
  return link;
}

function visibleCopy(preview: Preview): { message: string; detail: string | null } {
  if (preview.kind === "binary") {
    return {
      message: preview.reason === "image" ? "This image can't be previewed as text." : "This file can't be previewed as text.",
      detail: null,
    };
  }
  if (preview.kind === "large") {
    const detail = preview.lines === null ? null : `${groupNumber(preview.lines)} ${preview.lines === 1 ? "line" : "lines"}`;
    return { message: "This file is too large to preview here.", detail };
  }
  if (preview.kind === "error") return { message: preview.message, detail: null };
  return { message: "", detail: null };
}

function renderCode(preview: Extract<Preview, { kind: "code" }>): HTMLElement {
  const code = el("div", "bgh-preview-code");
  code.tabIndex = 0;
  code.setAttribute("role", "region");
  code.setAttribute("aria-label", preview.lines.length === 1 ? "File source, 1 line" : `File source, ${groupNumber(preview.lines.length)} lines`);
  code.style.tabSize = String(preview.tabSize);
  code.spellcheck = false;
  code.translate = false;
  const colors = tokenColors(code.ownerDocument);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < preview.lines.length; i++) {
    const line = preview.lines[i] ?? "";
    const row = el("span", "bgh-preview-line");
    const gutter = el("span", "bgh-preview-gutter", String(i + 1));
    gutter.setAttribute("aria-hidden", "true");
    const text = el("span", "bgh-preview-text");
    appendLine(text, line, preview.directives[i], colors);
    row.append(gutter, text);
    frag.append(row);
  }
  code.append(frag);
  code.addEventListener("copy", onCopy);
  return code;
}

/** Leading spaces and tabs stay in the text. A marker span only paints dots over them. */
function appendLine(parent: HTMLElement, line: string, directives: unknown, colors: Map<string, string>): void {
  const indent = indentLength(line);
  let remaining = indent;
  if (indent > 0) {
    const marker = el("span", "bgh-preview-indent");
    marker.textContent = line.slice(0, indent);
    parent.append(marker);
  }
  for (const segment of segmentsForLine(line, directives)) {
    let value = segment.text;
    if (remaining > 0) {
      const skip = Math.min(remaining, value.length);
      remaining -= skip;
      value = value.slice(skip);
    }
    if (!value) continue;
    if (segment.cls) {
      const token = document.createElement("span");
      token.className = segment.cls;
      token.textContent = value;
      const color = colors.get(segment.cls);
      if (color) token.style.color = color;
      parent.append(token);
    } else {
      parent.append(document.createTextNode(value));
    }
  }
}

/** Resolve GitHub prettylights colors from the page's own CSS variables. */
function tokenColors(doc: Document): Map<string, string> {
  const root = doc.documentElement;
  const style = doc.defaultView?.getComputedStyle(root);
  const read = (...names: string[]): string => {
    if (!style) return "";
    for (const name of names) {
      const value = style.getPropertyValue(name).trim();
      if (value) return value;
    }
    return "";
  };
  const map = new Map<string, string>();
  const put = (cls: string, value: string): void => {
    if (value) map.set(cls, value);
  };
  put("pl-c", read("--color-prettylights-syntax-comment", "--prettylights-syntax-comment"));
  put("pl-c1", read("--color-prettylights-syntax-constant", "--prettylights-syntax-constant"));
  put("pl-e", read("--color-prettylights-syntax-entity", "--prettylights-syntax-entity"));
  put("pl-en", read("--color-prettylights-syntax-entity", "--prettylights-syntax-entity"));
  put(
    "pl-smi",
    read("--color-prettylights-syntax-storage-modifier-import", "--prettylights-syntax-storageModifierImport"),
  );
  put(
    "pl-s1",
    read("--color-prettylights-syntax-storage-modifier-import", "--prettylights-syntax-storageModifierImport"),
  );
  put("pl-ent", read("--color-prettylights-syntax-entity-tag", "--prettylights-syntax-entityTag"));
  put("pl-k", read("--color-prettylights-syntax-keyword", "--prettylights-syntax-keyword"));
  put("pl-s", read("--color-prettylights-syntax-string", "--prettylights-syntax-string"));
  put("pl-pds", read("--color-prettylights-syntax-string", "--prettylights-syntax-string"));
  put("pl-sr", read("--color-prettylights-syntax-string", "--prettylights-syntax-string"));
  put("pl-v", read("--color-prettylights-syntax-variable", "--prettylights-syntax-variable"));
  put(
    "pl-corl",
    read(
      "--color-prettylights-syntax-constant-other-reference-link",
      "--prettylights-syntax-constantOtherReferenceLink",
    ),
  );
  return map;
}

function onCopy(event: ClipboardEvent): void {
  const root = event.currentTarget as HTMLElement | null;
  if (!root || !event.clipboardData) return;
  const text = exactSelection(root);
  if (text === null) return;
  event.preventDefault();
  event.clipboardData.setData("text/plain", text);
}

/** Selected source from the line text only, so gutters and dots never join the clipboard. */
function exactSelection(root: HTMLElement): string | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) && range.startContainer !== root) return null;
  const parts: string[] = [];
  for (const line of root.querySelectorAll<HTMLElement>(".bgh-preview-line")) {
    const text = line.querySelector<HTMLElement>(".bgh-preview-text");
    if (!text || !range.intersectsNode(text)) continue;
    const slice = root.ownerDocument.createRange();
    slice.selectNodeContents(text);
    if (text.contains(range.startContainer)) slice.setStart(range.startContainer, range.startOffset);
    if (text.contains(range.endContainer)) slice.setEnd(range.endContainer, range.endOffset);
    parts.push(slice.toString());
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function fill(ui: Shell, file: RepoFile, preview: Preview | { kind: "loading" }): void {
  ui.dialog.dataset.state = preview.kind;
  ui.dialog.setAttribute("aria-busy", preview.kind === "loading" ? "true" : "false");
  ui.body.replaceChildren();
  if (preview.kind === "loading") {
    ui.status.className = "bgh-preview-message";
    ui.status.textContent = "Loading preview…";
    ui.body.append(ui.status);
    return;
  }
  if (preview.kind === "code" && preview.lines.length > 0) {
    ui.status.className = "bgh-preview-sr";
    ui.status.textContent = "Source loaded.";
    ui.body.append(ui.status, renderCode(preview));
    return;
  }
  if (preview.kind === "code") {
    ui.status.className = "bgh-preview-message";
    ui.status.textContent = "This file is empty.";
    ui.body.append(ui.status);
    return;
  }
  const copy = visibleCopy(preview);
  ui.status.className = "bgh-preview-message";
  ui.status.textContent = copy.message;
  ui.body.append(ui.status);
  if (copy.detail) ui.body.append(el("p", "bgh-preview-detail", copy.detail));
}

function onWheel(event: WheelEvent): void {
  const root = shell?.root;
  const scroller = shell?.body;
  if (!root) return;
  const target = event.target as Node | null;
  if (!scroller || !target || !scroller.contains(target)) {
    event.preventDefault();
    return;
  }
  // Swallow the wheel only when the source itself cannot scroll that way, so the
  // page underneath does not move and the preview still scrolls.
  const blocked = (delta: number, atStart: boolean, atEnd: boolean) => {
    if (delta < 0) return atStart;
    if (delta > 0) return atEnd;
    return true;
  };
  const vertical = blocked(event.deltaY, scroller.scrollTop <= 0, Math.ceil(scroller.scrollTop + scroller.clientHeight) >= scroller.scrollHeight);
  const horizontal = blocked(
    event.deltaX,
    scroller.scrollLeft <= 0,
    Math.ceil(scroller.scrollLeft + scroller.clientWidth) >= scroller.scrollWidth,
  );
  if (vertical && horizontal) event.preventDefault();
}

function mount(file: RepoFile, link: HTMLAnchorElement): Shell {
  const root = el("div", "bgh-preview-backdrop");
  root.dataset.buffedGithub = "file-preview";
  const dialog = el("div", "bgh-preview");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "bgh-file-preview-title");
  dialog.tabIndex = -1;

  const header = el("div", "bgh-preview-header");
  // The path, with the file name brighter than its folders.
  const heading = el("h2", "bgh-preview-path");
  heading.id = "bgh-file-preview-title";
  heading.title = file.path;
  const name = oneLine(baseName(file.path)) || "File";
  const full = oneLine(file.path);
  const dir = full.endsWith(name) ? full.slice(0, full.length - name.length) : "";
  if (dir) heading.append(el("span", "bgh-preview-dir", dir));
  heading.append(el("span", "bgh-preview-title", name));

  const actions = el("div", "bgh-preview-actions");
  const open = el("a", "bgh-preview-open", "Open");
  open.href = link.href;
  open.setAttribute("aria-label", "Open file on GitHub");
  const close = el("button", "bgh-preview-close", "Close");
  close.type = "button";
  close.setAttribute("aria-label", "Close preview");
  close.addEventListener("click", () => closePreview(true));
  actions.append(close, open);
  header.append(actions, heading);

  const body = el("div", "bgh-preview-body");
  const status = el("p", "bgh-preview-message");
  status.setAttribute("role", "status");
  dialog.append(header, body);
  root.append(dialog);

  root.addEventListener("mousedown", (event) => {
    pointerDownOnBackdrop = event.target === root;
  });
  root.addEventListener("click", (event) => {
    if (pointerDownOnBackdrop && event.target === root) closePreview(true);
  });
  root.addEventListener("wheel", onWheel, { passive: false });

  (document.body ?? document.documentElement).append(root);
  const ui = { root, dialog, body, status, href: link.href };
  shell = ui;
  dialog.focus({ preventScroll: true });
  return ui;
}

function closePreview(restoreFocus: boolean): void {
  generation += 1;
  currentAbort?.abort();
  currentAbort = null;
  const previous = opener;
  opener = null;
  const node = shell?.root ?? null;
  shell = null;
  pointerDownOnBackdrop = false;
  node?.remove();
  if (restoreFocus && previous?.isConnected) previous.focus({ preventScroll: true });
}

function errorPreview(error: unknown): Preview {
  let detail = "";
  if (error && typeof error === "object" && "message" in error) detail = String(error.message);
  if (/^HTTP \d{3}$/.test(detail)) return { kind: "error", message: `Couldn't load a preview for this file (${detail}).` };
  return { kind: "error", message: "Couldn't load a preview for this file." };
}

function isAbort(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("name" in error)) return false;
  return (error as { name: unknown }).name === "AbortError";
}

/** Text of the file GitHub shows. Prefer the server-rendered code cells: they
 * already carry `pl-*` tokens. `rawLines` / `stylingDirectives` are the
 * fallback when cells are absent. The live textarea is client-only. */
function textFromBlobHtml(html: string): Preview | { image: true } | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const area = doc.querySelector<HTMLTextAreaElement>("#read-only-cursor-text-area");
  if (area && area.value.length > 0) return previewFromText(area.value);
  const root = doc.querySelector('section[aria-labelledby*="file-name-id"]');
  const cells = (root ?? doc).querySelectorAll('[data-testid="code-cell"]');
  if (cells.length) {
    const lines: string[] = [];
    const directives: unknown[] = [];
    for (const cell of cells) {
      const painted = directivesFromCodeCell(cell);
      lines.push(painted.line);
      directives.push(painted.directives);
    }
    return previewFromLines(lines, directives, tabSizeInHtml(html));
  }
  const highlighted = highlightedSource(html);
  if (highlighted) return previewFromLines(highlighted.lines, highlighted.directives, highlighted.tabSize);
  if (root?.querySelector("img, video")) return { image: true };
  if (area || root) return previewFromText("");
  return null;
}

async function blobHtml(pathname: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const runtime = extensionRuntime();
  if (runtime) {
    try {
      const reply = (await runtime.sendMessage({ type: "buffed-github:file-html", pathname })) as BlobReply;
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (reply?.ok && typeof reply.html === "string") return reply.html;
      if (typeof reply?.status === "number" && reply.status >= 400) throw new Error(`HTTP ${reply.status}`);
    } catch (error) {
      if (isAbort(error) || (error instanceof Error && /^HTTP \d{3}$/.test(error.message))) throw error;
    }
  }
  // Tests, and a background that did not answer. In Zen this fetch is the
  // page's fetch and GitHub may replace the body, so it is not the main path.
  const res = await fetch(`${location.origin}${pathname}?plain=1`, {
    credentials: "include",
    signal,
    cache: "no-store",
    headers: { Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function loadAndRender(gen: number, signal: AbortSignal, file: RepoFile, ui: Shell): Promise<void> {
  try {
    const html = await blobHtml(file.pathname, signal);
    if (gen !== generation || signal.aborted || !ui.root.isConnected) return;
    if (html.length > PREVIEW_LIMITS.maxHtmlChars) {
      fill(ui, file, { kind: "large", lines: null });
      return;
    }
    const read = textFromBlobHtml(html);
    if (!read) {
      fill(ui, file, { kind: "error", message: "Couldn't read the code from this page." });
      return;
    }
    if ("image" in read) {
      fill(ui, file, { kind: "binary", reason: "image" });
      return;
    }
    fill(ui, file, read);
  } catch (error) {
    if (gen !== generation || signal.aborted || isAbort(error) || !ui.root.isConnected) return;
    console.warn("[Buffed GitHub] file-preview:", error);
    fill(ui, file, errorPreview(error));
  }
}

function openPreview(link: HTMLAnchorElement, file: RepoFile): void {
  closePreview(false);
  const gen = generation;
  opener = link;
  const controller = new AbortController();
  currentAbort = controller;
  const ui = mount(file, link);
  fill(ui, file, { kind: "loading" });
  void loadAndRender(gen, controller.signal, file, ui);
}

function onKeydown(event: KeyboardEvent): void {
  const dialog = shell?.dialog;
  if (!dialog || !shell?.root.isConnected) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closePreview(true);
    return;
  }
  // Enter opens the file, unless a button or link in the dialog has focus.
  if (event.key === "Enter" && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    const active = document.activeElement;
    if (active && active !== dialog && active.closest("a[href], button")) return;
    event.preventDefault();
    event.stopPropagation();
    const href = shell.href;
    closePreview(false);
    location.assign(href);
    return;
  }
  if (event.key !== "Tab") return;
  const items = focusable(dialog);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  // Focus starts on the dialog itself, which is not one of the tab stops.
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (event.shiftKey) {
    if (index <= 0) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    }
  } else if (index < 0 || index >= items.length - 1) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function onClick(event: MouseEvent): void {
  if (!isPreviewClick(event) || event.defaultPrevented) return;
  const target = event.target as Element | null;
  if (!target?.closest) return;
  const link = linkFromTarget(target);
  if (!link) return;
  const file = fileFromHref(link.href, location.href);
  if (!file) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openPreview(link, file);
}

const feature: Feature = {
  id: "file-preview",
  name: "Quick file preview",
  description: "Click a file in the file table to preview it without leaving the page.",
  css,
  run() {
    document.removeEventListener("click", onClick, true);
    document.addEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeydown, true);
    document.addEventListener("keydown", onKeydown, true);
  },
};

export default feature;
