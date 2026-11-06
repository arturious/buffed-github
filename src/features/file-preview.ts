// Option-click (Alt-click) a file in a repo's file table to preview it in a
// dialog instead of navigating. Folders expanded in place stay expanded, and
// the page is not scrolled. The file text is read from the same-origin blob
// page and drawn as text nodes. Fetched HTML is parsed, never inserted, and
// its scripts are not run.
import type { Feature } from "../feature";
import css from "./file-preview.css";
import {
  PREVIEW_LIMITS,
  fileFromHref,
  isPreviewClick,
  previewFromText,
  rawLinesInHtml,
  segmentsForLine,
  type Preview,
  type RepoFile,
} from "./file-preview-model";

const TABLE = 'table[aria-labelledby="folders-and-files"]';

interface Shell {
  root: HTMLElement;
  dialog: HTMLElement;
  body: HTMLElement;
  meta: HTMLElement;
  status: HTMLElement;
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

function linkFromTarget(target: Element): HTMLAnchorElement | null {
  if (!target.closest(TABLE)) return null;
  const direct = target.closest("a[href]");
  if (direct) {
    const link = direct as HTMLAnchorElement;
    return fileFromHref(link.href, location.href) ? link : null;
  }
  const column = target.closest(".react-directory-filename-column");
  const candidate = column?.querySelector("a[href]") as HTMLAnchorElement | null;
  if (!candidate || !fileFromHref(candidate.href, location.href)) return null;
  return candidate;
}

function metaText(file: RepoFile, preview?: Preview): string {
  const parts: string[] = [];
  if (preview?.kind === "code" && preview.language) parts.push(preview.language);
  const size = preview && preview.kind !== "error" ? preview.sizeLabel : null;
  if (size) parts.push(size);
  const ref = oneLine(file.ref);
  if (ref) parts.push(ref);
  return parts.join(" · ");
}

function visibleCopy(preview: Preview): { message: string; detail: string | null } {
  if (preview.kind === "binary") {
    return {
      message: preview.reason === "image" ? "This image can't be previewed as text." : "This file can't be previewed as text.",
      detail: preview.sizeLabel,
    };
  }
  if (preview.kind === "large") {
    const parts: string[] = [];
    if (preview.lines !== null) parts.push(`${groupNumber(preview.lines)} ${preview.lines === 1 ? "line" : "lines"}`);
    if (preview.sizeLabel) parts.push(preview.sizeLabel);
    return { message: "This file is too large to preview here.", detail: parts.join(" · ") || null };
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
  const frag = document.createDocumentFragment();
  for (let i = 0; i < preview.lines.length; i++) {
    const row = el("span", "bgh-preview-line");
    const gutter = el("span", "bgh-preview-gutter", String(i + 1));
    gutter.setAttribute("aria-hidden", "true");
    const text = el("span", "bgh-preview-text");
    for (const segment of segmentsForLine(preview.lines[i] ?? "", preview.directives[i])) {
      if (segment.cls) {
        const token = document.createElement("span");
        token.className = segment.cls;
        token.textContent = segment.text;
        text.append(token);
      } else {
        text.append(document.createTextNode(segment.text));
      }
    }
    row.append(gutter, text);
    frag.append(row);
  }
  code.append(frag);
  return code;
}

function fill(ui: Shell, file: RepoFile, preview: Preview | { kind: "loading" }): void {
  ui.dialog.dataset.state = preview.kind;
  ui.dialog.setAttribute("aria-busy", preview.kind === "loading" ? "true" : "false");
  ui.meta.textContent = preview.kind === "loading" ? metaText(file) : metaText(file, preview);
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
  const heading = el("div", "bgh-preview-heading");
  const title = el("h2", "bgh-preview-title", oneLine(baseName(file.path)) || "File");
  title.id = "bgh-file-preview-title";
  const path = el("p", "bgh-preview-path", oneLine(file.path));
  path.title = file.path;
  const meta = el("p", "bgh-preview-meta");
  heading.append(title, path, meta);

  const actions = el("div", "bgh-preview-actions");
  const open = el("a", "bgh-preview-open", "Open");
  open.href = link.href;
  open.setAttribute("aria-label", "Open file on GitHub");
  const close = el("button", "bgh-preview-close", "Close");
  close.type = "button";
  close.setAttribute("aria-label", "Close preview");
  close.addEventListener("click", () => closePreview(true));
  actions.append(open, close);
  header.append(heading, actions);

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
  const ui = { root, dialog, body, meta, status };
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

/** Text of the file GitHub shows. The live `#read-only-cursor-text-area` is
 * created by client script and is not in fetched HTML; `rawLines` is what
 * GitHub copies into it. Code cells are the server-rendered block, kept for
 * pages that have no `rawLines`. */
function textFromBlobHtml(html: string): { text: string } | { image: true } | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const area = doc.querySelector<HTMLTextAreaElement>("#read-only-cursor-text-area");
  if (area && area.value.length > 0) return { text: area.value };
  const embedded = rawLinesInHtml(html);
  if (embedded) return { text: embedded.join("\n") };
  const root = doc.querySelector('section[aria-labelledby*="file-name-id"]');
  const cells = (root ?? doc).querySelectorAll('[data-testid="code-cell"]');
  if (cells.length) return { text: Array.from(cells, (cell) => cell.textContent ?? "").join("\n") };
  if (root?.querySelector("img, video")) return { image: true };
  if (area || root) return { text: "" };
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
  const res = await fetch(location.origin + pathname, {
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
      fill(ui, file, { kind: "large", lines: null, sizeLabel: null });
      return;
    }
    const read = textFromBlobHtml(html);
    if (!read) {
      fill(ui, file, { kind: "error", message: "Couldn't read the code from this page." });
      return;
    }
    if ("image" in read) {
      fill(ui, file, { kind: "binary", reason: "image", sizeLabel: null });
      return;
    }
    fill(ui, file, previewFromText(read.text, "text/plain"));
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
  description: "Option-click a file in the file table to preview it without leaving the page.",
  css,
  run() {
    document.removeEventListener("click", onClick, true);
    document.addEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeydown, true);
    document.addEventListener("keydown", onKeydown, true);
  },
};

export default feature;
