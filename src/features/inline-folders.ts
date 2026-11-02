// Click a folder in a repo's file table to expand it in place instead of
// opening its page; a chevron in front of each folder shows its state.
import type { Feature } from "../feature";

// GitHub's file table on the repo page and on folder pages.
const TABLE = 'table[aria-labelledby="folders-and-files"]';
const TREE_HREF = /^\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/;
const INDENT = 20; // px per nesting level

interface Item {
  name: string;
  path: string;
  dir: boolean;
}

/** Last commit of an item, as GitHub's tree-commit-info returns it. */
interface CommitInfo {
  url: string;
  date: string;
  shortMessageHtmlLink?: { value: string };
}

/** Where a folder link points. */
interface Folder {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}

// Octicon paths: file-directory-fill and file.
const ICON_PATHS = {
  dir: "M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z",
  file: "M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z",
};

// Octicon chevron-right, used as a mask so it takes the text color.
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M6.22 3.22a.749.749 0 0 1 1.06 0l4.25 4.25a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.042-.018.749.749 0 0 1-.018-1.042L9.94 8 6.22 4.28a.749.749 0 0 1 0-1.06Z'/%3E%3C/svg%3E\")";

// Chevron before every folder (down when expanded), an empty slot of the same
// width before files so names stay aligned. CSS only: GitHub's own rows are
// rendered by React and are left untouched.
const CSS = `
  /* every item type: (Directory), (File), (Symlink to file), ...
     (symlink links have no Link--primary class) */
  ${TABLE} tr:has(.react-directory-filename-column a[aria-label*=", ("]) .react-directory-filename-column::before {
    content: "";
    flex: none;
    width: 16px;
    height: 16px;
    margin-inline-end: -4px;
    align-self: center;
  }
  ${TABLE} tr:has(.react-directory-filename-column a[aria-label$=", (Directory)"]) .react-directory-filename-column::before {
    background-color: var(--fgColor-muted, #9198a1);
    mask: ${CHEVRON} center / 16px no-repeat;
    transition: transform 0.15s ease;
    cursor: pointer;
  }
  ${TABLE} tr[data-inline-expanded] .react-directory-filename-column::before {
    transform: rotate(90deg);
  }
`;

// Firefox content scripts: content.fetch() requests as the page itself, with
// its cookies, so private repos work.
function pageFetch(url: string, init?: RequestInit): Promise<Response> {
  return (globalThis.content?.fetch ?? fetch)(location.origin + url, init);
}

// Folder contents. GitHub's own JSON for the folder page first (works for
// private repos too), the public REST API as a fallback.
async function listFolder({ owner, repo, ref, path }: Folder): Promise<Item[]> {
  try {
    const res = await pageFetch(`/${owner}/${repo}/tree/${ref}/${path}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    const payload = res.ok ? (await res.json())?.payload : undefined;
    const items: unknown = (payload?.codeViewTreeRoute ?? payload)?.tree?.items;
    if (Array.isArray(items)) {
      return items.map((i: { name: string; path: string; contentType: string }) => ({
        name: i.name,
        path: i.path,
        dir: i.contentType === "directory",
      }));
    }
  } catch {}
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`);
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const items = (await res.json()) as { name: string; path: string; type: string }[];
  return items.map((i) => ({ name: i.name, path: i.path, dir: i.type === "dir" }));
}

// Last commit per item name: the same request GitHub's folder page makes.
// Empty on failure; rows just stay blank.
async function commitInfo({ owner, repo, ref, path }: Folder): Promise<Record<string, CommitInfo>> {
  try {
    const res = await pageFetch(`/${owner}/${repo}/tree-commit-info/${ref}/${path}`, {
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin",
    });
    return (res.ok && (await res.json())?.entries) || {};
  } catch {
    return {};
  }
}

// The same classes GitHub gives its own icons, so they're colored alike.
function icon(dir: boolean): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", dir ? "octicon octicon-file-directory-fill icon-directory" : "octicon octicon-file color-fg-muted");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "currentColor");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", dir ? ICON_PATHS.dir : ICON_PATHS.file);
  svg.append(path);
  return svg;
}

// GitHub sends the commit link as HTML; only its text and title are taken
// from it (parsed inert), the link itself is built here.
function commitLink(info: CommitInfo): HTMLAnchorElement {
  const parsed = new DOMParser().parseFromString(info.shortMessageHtmlLink?.value ?? "", "text/html");
  const source = parsed.querySelector("a");
  const a = document.createElement("a");
  a.className = "Link--secondary";
  a.href = info.url;
  a.title = source?.title ?? "";
  a.textContent = source?.textContent ?? "";
  return a;
}

function removeChildren(path: string): void {
  for (const tr of document.querySelectorAll<HTMLTableRowElement>("tr.inline-folder-row")) {
    if (tr.dataset.path?.startsWith(path + "/")) tr.remove();
  }
}

// A copy of GitHub's own row (same cells and classes, so the table keeps its
// columns and icon extensions still recognise it), renamed to the item, with
// its own last commit message and date.
function makeRow(template: HTMLTableRowElement, folder: Folder, item: Item, depth: number) {
  const tr = template.cloneNode(true) as HTMLTableRowElement;
  tr.removeAttribute("id");
  tr.classList.add("inline-folder-row");
  delete tr.dataset.inlineExpanded;
  tr.dataset.path = item.path;
  const href = `/${folder.owner}/${folder.repo}/${item.dir ? "tree" : "blob"}/${folder.ref}/${item.path}`;
  for (const td of tr.cells) {
    const a = td.querySelector<HTMLAnchorElement>("a.Link--primary");
    if (a) {
      a.href = href;
      a.title = item.name;
      a.setAttribute("aria-label", `${item.name}, (${item.dir ? "Directory" : "File"})`);
      a.textContent = item.name;
      td.querySelector("svg")?.replaceWith(icon(item.dir));
      td.style.paddingLeft = `calc(16px + ${depth * INDENT}px)`;
    } else if (td.querySelector(".react-directory-commit-age")) {
      td.replaceChildren();
      td.dataset.commitAge = "";
    } else {
      td.replaceChildren();
    }
  }
  return tr;
}

// The commit message and date of a row from makeRow(), once they arrive.
function fillCommit(tr: HTMLTableRowElement, info: CommitInfo): void {
  for (const td of tr.cells) {
    if (td.classList.contains("react-directory-row-commit-cell")) {
      // one line, cut with an ellipsis, like GitHub's own rows
      const line = document.createElement("div");
      line.style.cssText = "overflow: hidden; white-space: nowrap; text-overflow: ellipsis;";
      line.append(commitLink(info));
      td.replaceChildren(line);
    } else if (td.dataset.commitAge !== undefined && info.date) {
      const age = document.createElement("div");
      age.className = "react-directory-commit-age";
      const time = document.createElement("relative-time");
      time.setAttribute("datetime", info.date);
      time.setAttribute("tense", "past");
      age.append(time);
      td.replaceChildren(age);
    }
  }
}

// Both requests per folder, started once and kept for the page: hovering a
// folder starts them, so by the click they're usually done.
const cache = new Map<string, { items: Promise<Item[]>; info: Promise<Record<string, CommitInfo>> }>();

function load(folder: Folder) {
  const key = `${folder.owner}/${folder.repo}/${folder.ref}/${folder.path}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = { items: listFolder(folder), info: commitInfo(folder) };
    entry.items.catch(() => cache.delete(key)); // let a later click retry
    cache.set(key, entry);
  }
  return entry;
}

// The folder a table link points to, or null for files.
function folderOf(link: HTMLAnchorElement): Folder | null {
  const match = new URL(link.href, location.href).pathname.match(TREE_HREF);
  if (!match) return null;
  const [, owner = "", repo = "", ref = "", path = ""] = match;
  return { owner, repo, ref, path: decodeURIComponent(path) };
}

async function toggle(row: HTMLTableRowElement, link: HTMLAnchorElement, folder: Folder): Promise<void> {
  if (row.dataset.inlineExpanded) {
    delete row.dataset.inlineExpanded;
    removeChildren(folder.path);
    return;
  }
  // a token per expand: a slow load from an earlier expand won't add its rows
  const token = crypto.randomUUID();
  row.dataset.inlineExpanded = token;
  link.style.opacity = "0.5";
  try {
    const { items: itemsPromise, info } = load(folder);
    // folders first, like GitHub; a copy, the cached list stays as is
    const items = [...(await itemsPromise)].sort(
      (a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name),
    );
    if (row.dataset.inlineExpanded !== token) return; // collapsed again while loading
    const depth = folder.path.split("/").length;
    const rows = new Map<string, HTMLTableRowElement>();
    let after = row;
    for (const item of items) {
      const tr = makeRow(row, folder, item, depth);
      after.after(tr);
      after = tr;
      rows.set(item.name, tr);
    }
    // the list is shown already; commits fill in whenever they arrive
    void info.then((entries) => {
      for (const [name, tr] of rows) {
        const entry = entries[name];
        if (entry && tr.isConnected) fillCommit(tr, entry);
      }
    });
  } catch (error) {
    if (row.dataset.inlineExpanded !== token) return;
    delete row.dataset.inlineExpanded;
    console.warn("[Buffed GitHub] inline-folders:", error);
    location.href = link.href; // couldn't list it: open the folder normally
  } finally {
    link.style.opacity = "";
  }
}

// Capture phase: runs before GitHub's own router sees the click. Handles the
// folder name and the chevron in front of it.
function onClick(event: MouseEvent): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target as Element | null;
  if (!target?.closest(TABLE)) return;
  let link = target.closest<HTMLAnchorElement>("a[href]");
  if (!link) {
    const column = target.closest(".react-directory-filename-column");
    // the chevron is the column's ::before, i.e. its first 16px
    if (!column || event.clientX > column.getBoundingClientRect().left + 16) return;
    link = column.querySelector<HTMLAnchorElement>("a.Link--primary");
    if (!link) return;
  }
  const folder = folderOf(link);
  const row = link.closest("tr");
  if (!folder || !row) return; // a file, not a folder
  event.preventDefault();
  event.stopImmediatePropagation();
  void toggle(row, link, folder);
}

// Start loading a folder once the pointer rests on its row for HOVER_DELAY ms:
// aiming at a folder preloads it, sweeping across the list loads nothing.
const HOVER_DELAY = 100;
let hoveredRow: Element | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;

function onHover(event: MouseEvent): void {
  const row = (event.target as Element | null)?.closest(`${TABLE} tr`) ?? null;
  if (row === hoveredRow) return; // still over the same row
  hoveredRow = row;
  clearTimeout(hoverTimer);
  const link = row?.querySelector<HTMLAnchorElement>('.react-directory-filename-column a[aria-label$=", (Directory)"]');
  const folder = link && folderOf(link);
  if (folder) hoverTimer = setTimeout(() => load(folder), HOVER_DELAY);
}

const feature: Feature = {
  id: "inline-folders",
  name: "Inline folders",
  description: "Expand folders right in the file table instead of opening them.",
  run() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mouseover", onHover, { passive: true });
  },
};

export default feature;
