// Simulated page tests. jsdom stands in for GitHub; nothing here launches
// Firefox or Zen, and nothing is clicked in a real browser.
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM, VirtualConsole, type TestWindow } from "jsdom";
import { features } from "../src/features/index";
import filePreview from "../src/features/file-preview";
import { PREVIEW_LIMITS, fileFromHref, isPreviewClick } from "../src/features/file-preview-model";

const BASE = "https://github.com/acme/widgets";

const TABLE = `
  <table aria-labelledby="folders-and-files">
    <tbody>
      <tr id="file-row">
        <td class="react-directory-filename-column">
          <a class="Link--primary" href="/acme/widgets/blob/main/src/app.ts" aria-label="app.ts, (File)">app.ts</a>
        </td>
        <td><a id="commit" href="/acme/widgets/commit/abc">fix things</a></td>
      </tr>
      <tr id="dir-row">
        <td class="react-directory-filename-column">
          <a class="Link--primary" href="/acme/widgets/tree/main/src" aria-label="src, (Directory)">src</a>
        </td>
      </tr>
      <tr id="other-file">
        <td class="react-directory-filename-column">
          <a class="Link--primary" href="/acme/widgets/blob/main/src/util.ts">util.ts</a>
        </td>
      </tr>
      <tr id="readme-row">
        <td class="react-directory-filename-column">
          <a href="/acme/widgets/blob/main/README.md">README.md</a>
        </td>
      </tr>
    </tbody>
  </table>
`;

function installDom(body = TABLE, url = BASE) {
  const navigations: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error: Error & { type?: string }) => {
    if (error.type === "not-implemented" && error.message.includes("navigation")) {
      navigations.push(error.message);
      return;
    }
    console.error(error);
  });
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    url,
    pretendToBeVisual: true,
    virtualConsole,
  });
  const previous = {
    document: globalThis.document,
    location: globalThis.location,
    fetch: globalThis.fetch,
    DOMParser: globalThis.DOMParser,
    MutationObserver: globalThis.MutationObserver,
  };
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.DOMParser = (dom.window as unknown as { DOMParser: typeof DOMParser }).DOMParser;
  globalThis.MutationObserver = (dom.window as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver;
  return {
    window: dom.window,
    document: dom.window.document,
    navigations,
    restore() {
      globalThis.document = previous.document;
      globalThis.location = previous.location;
      globalThis.fetch = previous.fetch;
      globalThis.DOMParser = previous.DOMParser;
      globalThis.MutationObserver = previous.MutationObserver;
      dom.window.close();
    },
  };
}

function codeHtml(text: string): string {
  const cells = text.split("\n").map((line) => `<div data-testid="code-cell">${line.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`).join("");
  return `<section aria-labelledby="file-name-id">${cells}</section><script>globalThis.__pwned = true</script>`;
}

function click(window: TestWindow, target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    detail: 1,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".bgh-preview");
}

function flags(): { __pwned?: boolean } {
  return globalThis as { __pwned?: boolean };
}

test("preview click is a plain primary click, and nothing else", () => {
  const base = { button: 0, altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, detail: 1 };
  assert.equal(isPreviewClick(base), true);
  assert.equal(isPreviewClick({ ...base, detail: 2 }), true);
  assert.equal(isPreviewClick({ ...base, altKey: true }), false);
  assert.equal(isPreviewClick({ ...base, detail: 0 }), false);
  assert.equal(isPreviewClick({ ...base, button: 1 }), false);
  assert.equal(isPreviewClick({ ...base, metaKey: true }), false);
  assert.equal(isPreviewClick({ ...base, ctrlKey: true }), false);
  assert.equal(isPreviewClick({ ...base, shiftKey: true }), false);
});

test("file links are blob paths on this origin", () => {
  assert.deepEqual(fileFromHref("/acme/widgets/blob/main/src/a%20b.ts?plain=1#L2", BASE), {
    owner: "acme",
    repo: "widgets",
    ref: "main",
    path: "src/a b.ts",
    pathname: "/acme/widgets/blob/main/src/a%20b.ts",
  });
  assert.equal(fileFromHref("/acme/widgets/tree/main/src", BASE), null);
  assert.equal(fileFromHref("https://evil.example/acme/widgets/blob/main/a.ts", BASE), null);
  assert.equal(fileFromHref("javascript:alert(1)", BASE), null);
  assert.equal(fileFromHref("https://github.com/acme/widgets/commit/abc", BASE), null);
});

test("quick file preview is its own switch and does not replace the other features", () => {
  assert.deepEqual(
    features.map((feature) => feature.id),
    ["inline-folders", "file-preview", "black-theme", "github-corner"],
  );
  const folders = features.find((feature) => feature.id === "inline-folders");
  const preview = features.find((feature) => feature.id === "file-preview");
  const theme = features.find((feature) => feature.id === "black-theme");
  assert.equal(folders?.name, "Inline folders");
  assert.match(folders?.description ?? "", /file table/);
  assert.equal(preview?.name, "Quick file preview");
  assert.match(preview?.description ?? "", /Click a file/);
  assert.match(preview?.css ?? "", /position:\s*fixed/);
  assert.match(preview?.css ?? "", /overflow:\s*auto/);
  assert.match(preview?.css ?? "", /--bgColor-default/);
  assert.match(preview?.css ?? "", /--fgColor-default/);
  assert.match(preview?.css ?? "", /--overlay-backdrop-bgColor/);
  assert.match(theme?.css ?? "", /#000000/);
  assert.match(theme?.css ?? "", /prefers-color-scheme:\s*light/);
  assert.equal(typeof folders?.run, "function");
  assert.equal(typeof preview?.run, "function");
});

test("a click previews a file as text and leaves other clicks alone", async () => {
  const page = installDom();
  try {
    const seen: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("/blob/")) seen.push({ url: String(input), init });
      return new Response(codeHtml("const a = 1;"), { status: 200, headers: { "content-type": "text/html" } });
    };
    for (const feature of features) feature.run?.();
    const link = page.document.querySelector<HTMLAnchorElement>("#file-row a.Link--primary")!;
    let reached = false;
    link.addEventListener("click", () => {
      reached = true;
    });

    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { detail: 0 }]) {
      const event = click(page.window, link, init);
      assert.equal(event.defaultPrevented, false, JSON.stringify(init));
    }
    assert.equal(reached, true);
    assert.equal(dialog(), null);
    // Folder links belong to inline folders, never to the preview.
    click(page.window, page.document.querySelector("#dir-row a")!);
    assert.equal(dialog(), null);
    const commit = click(page.window, page.document.querySelector("#commit")!);
    assert.equal(commit.defaultPrevented, false);

    await flush();
    reached = false;
    const navigated = page.navigations.length;
    // Empty space in the row is not the file.
    const cell = click(page.window, page.document.querySelector("#file-row td")!);
    assert.equal(cell.defaultPrevented, false);
    assert.equal(dialog(), null);

    const file = click(page.window, link);
    assert.equal(file.defaultPrevented, true);
    assert.equal(reached, false);
    await flush();
    assert.equal(page.navigations.length, navigated);
    await flush();

    const box = dialog();
    assert.ok(box);
    assert.equal(box.dataset.state, "code");
    assert.equal(box.getAttribute("role"), "dialog");
    assert.equal(box.getAttribute("aria-modal"), "true");
    assert.equal(page.document.querySelector(".bgh-preview-title")?.textContent, "app.ts");
    assert.equal(page.document.querySelector(".bgh-preview-dir")?.textContent, "src/");
    assert.equal(page.document.querySelector(".bgh-preview-path")?.textContent, "src/app.ts");
    assert.equal(page.document.querySelector(".bgh-preview-meta"), null);
    assert.equal(page.document.querySelector(".bgh-preview-text span"), null);
    assert.equal(page.document.querySelector(".bgh-preview-text")?.textContent, "const a = 1;");
    assert.equal(box.querySelector("script, img"), null);
    assert.equal(flags().__pwned, undefined);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.url, `${BASE}/blob/main/src/app.ts?plain=1`);
    assert.equal(seen[0]?.init?.credentials, "include");
    assert.match(new Headers(seen[0]?.init?.headers).get("accept") ?? "", /text\/html/);
    assert.equal(page.window.location.pathname, "/acme/widgets");
  } finally {
    page.restore();
  }
});

test("preview keeps expanded folders and does not move the page", async () => {
  const page = installDom();
  try {
    let scrollSets = 0;
    let scrolled = 0;
    page.window.scrollTo = () => {
      scrolled += 1;
    };
    Object.defineProperty(page.document.documentElement, "scrollTop", {
      configurable: true,
      get: () => 120,
      set: () => {
        scrollSets += 1;
      },
    });
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/blob/")) return new Response(codeHtml("export const n = 1;"), { status: 200 });
      if (url.includes("/tree-commit-info/")) return new Response(JSON.stringify({ entries: {} }), { status: 200 });
      if (url.includes("/tree/")) {
        return new Response(
          JSON.stringify({ payload: { tree: { items: [{ name: "app.ts", path: "src/app.ts", contentType: "file" }] } } }),
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    };
    for (const feature of features) feature.run?.();
    click(page.window, page.document.querySelector("#dir-row a")!);
    for (let i = 0; i < 20 && !page.document.querySelector(".inline-folder-row"); i++) await flush();
    const child = page.document.querySelector<HTMLAnchorElement>(".inline-folder-row a");
    assert.ok(child);
    assert.equal(child.textContent, "app.ts");
    const expanded = page.document.querySelector("#dir-row")?.getAttribute("data-inline-expanded");
    assert.ok(expanded);

    click(page.window, child);
    await flush();
    assert.equal(dialog()?.dataset.state, "code");
    assert.match(page.document.querySelector(".bgh-preview-text")?.textContent ?? "", /export const n = 1;/);
    assert.equal(page.document.querySelector("#dir-row")?.getAttribute("data-inline-expanded"), expanded);
    assert.ok(child.isConnected);

    page.document.dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(dialog(), null);
    assert.equal(page.document.querySelector("#dir-row")?.getAttribute("data-inline-expanded"), expanded);
    assert.ok(child.isConnected);
    assert.equal(scrollSets, 0);
    assert.equal(scrolled, 0);
    assert.equal(page.window.location.pathname, "/acme/widgets");
  } finally {
    page.restore();
  }
});

test("rows inserted later and links without Link--primary can be previewed", async () => {
  const page = installDom();
  try {
    globalThis.fetch = async () => new Response(codeHtml("# readme"), { status: 200 });
    filePreview.run?.();
    const row = page.document.createElement("tr");
    row.className = "inline-folder-row";
    row.innerHTML = `<td class="react-directory-filename-column"><a class="Link--primary" href="/acme/widgets/blob/main/src/late.ts">late.ts</a></td>`;
    page.document.querySelector("tbody")?.append(row);
    click(page.window, row.querySelector("a")!);
    await flush();
    assert.equal(page.document.querySelector(".bgh-preview-title")?.textContent, "late.ts");
    page.document.querySelector<HTMLButtonElement>(".bgh-preview-close")?.click();
    assert.equal(dialog(), null);

    click(page.window, page.document.querySelector("#readme-row a")!);
    await flush();
    assert.equal(page.document.querySelector(".bgh-preview-title")?.textContent, "README.md");
    assert.equal(page.document.querySelector(".bgh-preview-text")?.textContent, "# readme");
  } finally {
    page.restore();
  }
});

test("Enter opens the previewed file", async () => {
  const page = installDom();
  try {
    globalThis.fetch = async () => new Response(codeHtml("const a = 1;"), { status: 200 });
    filePreview.run?.();
    click(page.window, page.document.querySelector("#file-row a")!);
    await flush();
    assert.ok(dialog());
    const before = page.navigations.length;
    const enter = new page.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    page.document.documentElement.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, true);
    assert.equal(dialog(), null);
    assert.equal(page.navigations.length, before + 1);
  } finally {
    page.restore();
  }
});

test("Close, Escape, and a click outside dismiss the dialog and return focus", async () => {
  const page = installDom();
  try {
    globalThis.fetch = async () => new Response(codeHtml("const a = 1;"), { status: 200 });
    filePreview.run?.();
    const link = page.document.querySelector<HTMLAnchorElement>("#file-row a")!;
    link.focus();
    click(page.window, link);
    await flush();
    const box = dialog();
    assert.ok(box);
    assert.ok(box.contains(page.document.activeElement) || page.document.activeElement === box);

    const backdrop = page.document.querySelector(".bgh-preview-backdrop")!;
    box.dispatchEvent(new page.window.MouseEvent("mousedown", { bubbles: true }));
    backdrop.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    assert.ok(dialog(), "a drag that ends outside the dialog stays open");
    box.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    assert.ok(dialog(), "a click inside the dialog stays open");

    const code = page.document.querySelector<HTMLElement>(".bgh-preview-code")!;
    code.focus();
    const tab = new page.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    page.document.documentElement.dispatchEvent(tab);
    assert.equal(tab.defaultPrevented, true);
    assert.equal(page.document.activeElement, page.document.querySelector(".bgh-preview-close"));
    const back = new page.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, shiftKey: true });
    page.document.documentElement.dispatchEvent(back);
    assert.equal(back.defaultPrevented, true);
    assert.equal(page.document.activeElement, code);

    page.document.documentElement.dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(dialog(), null);
    assert.equal(page.document.activeElement, link);

    click(page.window, link);
    await flush();
    backdrop.dispatchEvent(new page.window.MouseEvent("mousedown", { bubbles: true }));
    backdrop.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    assert.equal(dialog(), null);
    assert.equal(page.document.activeElement, link);

    click(page.window, link);
    await flush();
    page.document.querySelector<HTMLButtonElement>(".bgh-preview-close")?.click();
    assert.equal(dialog(), null);
    assert.equal(page.document.activeElement, link);
    const wheel = new page.window.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40 });
    // The backdrop is gone; open again and wheel the dimmed area.
    click(page.window, link);
    await flush();
    page.document.querySelector(".bgh-preview-backdrop")?.dispatchEvent(wheel);
    assert.equal(wheel.defaultPrevented, true);
    assert.equal(page.window.location.pathname, "/acme/widgets");
  } finally {
    page.restore();
  }
});

test("loading, errors, empty, binary, and large files have their own states", async () => {
  const page = installDom();
  const warn = console.warn;
  console.warn = () => {};
  try {
    let release: ((response: Response) => void) | undefined;
    globalThis.fetch = () => new Promise<Response>((resolve) => {
      release = resolve;
    });
    filePreview.run?.();
    const link = page.document.querySelector<HTMLAnchorElement>("#file-row a")!;
    click(page.window, link);
    assert.equal(dialog()?.dataset.state, "loading");
    assert.match(page.document.body.textContent ?? "", /Loading preview…/);
    assert.equal(page.document.querySelector(".bgh-preview-code"), null);

    const late = codeHtml("LATE_SECRET");
    page.document.documentElement.dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(dialog(), null);
    release?.(new Response(late, { status: 200 }));
    await flush();
    assert.equal(dialog(), null);
    assert.equal((page.document.body.textContent ?? "").includes("LATE_SECRET"), false);

    const pending = new Map<string, (response: Response) => void>();
    globalThis.fetch = (input) => new Promise<Response>((resolve) => pending.set(String(input), resolve));
    click(page.window, link);
    click(page.window, page.document.querySelector("#other-file a")!);
    assert.equal(page.document.querySelector(".bgh-preview-title")?.textContent, "util.ts");
    pending.get(`${BASE}/blob/main/src/app.ts?plain=1`)?.(new Response(codeHtml("FIRST_SECRET"), { status: 200 }));
    pending.get(`${BASE}/blob/main/src/util.ts?plain=1`)?.(new Response(codeHtml("second file"), { status: 200 }));
    await flush();
    assert.equal((page.document.body.textContent ?? "").includes("FIRST_SECRET"), false);
    assert.match(page.document.querySelector(".bgh-preview-text")?.textContent ?? "", /second file/);

    globalThis.fetch = async () => new Response("nope", { status: 502 });
    click(page.window, link);
    await flush();
    assert.equal(dialog()?.dataset.state, "error");
    assert.match(page.document.querySelector(".bgh-preview-message")?.textContent ?? "", /HTTP 502/);

    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    click(page.window, link);
    await flush();
    assert.equal(dialog()?.dataset.state, "error");
    assert.match(page.document.querySelector(".bgh-preview-message")?.textContent ?? "", /Couldn't load a preview/);
    assert.equal((page.document.querySelector(".bgh-preview-message")?.textContent ?? "").includes("offline"), false);

    globalThis.fetch = async () => new Response(`<section aria-labelledby="file-name-id"></section>`, { status: 200, headers: { "content-type": "text/html" } });
    click(page.window, link);
    await flush();
    assert.equal(dialog()?.dataset.state, "code");
    assert.match(page.document.body.textContent ?? "", /This file is empty/);

    globalThis.fetch = async () => new Response(`<section aria-labelledby="file-name-id"><img alt="" src="/pic.png"></section>`, { status: 200, headers: { "content-type": "text/html" } });
    click(page.window, link);
    await flush();
    assert.equal(dialog()?.dataset.state, "binary");
    assert.match(page.document.body.textContent ?? "", /image can't be previewed/);
    assert.equal((page.document.body.textContent ?? "").includes("PNGDATA"), false);

    globalThis.fetch = async () => new Response(codeHtml("x".repeat(PREVIEW_LIMITS.maxChars + 1)), { status: 200, headers: { "content-type": "text/html" } });
    click(page.window, link);
    await flush();
    assert.equal(dialog()?.dataset.state, "large");
    assert.match(page.document.body.textContent ?? "", /too large to preview/);
    assert.equal((page.document.body.textContent ?? "").includes("xxxx"), false);
    assert.equal(page.document.querySelector<HTMLAnchorElement>(".bgh-preview-open")?.href, link.href);
    const partial = `<section aria-labelledby="file-name-id"><div data-testid="code-cell">only</div></section>{"rawLines":["one","two","three"]}`;
    globalThis.fetch = async () => new Response(partial, { status: 200, headers: { "content-type": "text/html" } });
    click(page.window, link);
    await flush();
    assert.deepEqual(
      Array.from(page.document.querySelectorAll(".bgh-preview-text"), (node) => node.textContent),
      ["only"],
    );
    assert.equal(page.window.location.pathname, "/acme/widgets");
  } finally {
    console.warn = warn;
    page.restore();
  }
});

test("source that looks like markup is text, including a broken script tag in the payload", async () => {
  const page = installDom();
  try {
    const attack = '<script>globalThis.__pwned = true</script><img src=x onerror="globalThis.__pwned = true">';
    globalThis.fetch = async () => new Response(codeHtml(attack), { status: 200, headers: { "content-type": "text/html" } });
    filePreview.run?.();
    click(page.window, page.document.querySelector("#file-row a")!);
    await flush();
    const box = dialog();
    assert.ok(box);
    assert.equal(page.document.querySelector(".bgh-preview-text")?.textContent, attack);
    assert.equal(box.querySelector("script, img"), null);
    for (const node of box.querySelectorAll<HTMLElement>("*")) {
      assert.equal(node.getAttribute("onerror"), null);
      assert.equal(node.getAttribute("onclick"), null);
    }
    assert.equal(flags().__pwned, undefined);

    const broken = `</script><script>globalThis.__pwned = true</script>`;
    globalThis.fetch = async () => new Response(codeHtml(broken), { status: 200, headers: { "content-type": "text/html" } });
    click(page.window, page.document.querySelector("#file-row a")!);
    await flush();
    assert.equal(dialog()?.dataset.state, "code");
    assert.equal(page.document.querySelector(".bgh-preview-text")?.textContent, broken);
    assert.equal(dialog()?.querySelector("script"), null);
    assert.equal(flags().__pwned, undefined);
  } finally {
    page.restore();
  }
});

test("syntax colors and indent marks do not change the copied source", async () => {
  const page = installDom();
  try {
    page.document.documentElement.style.setProperty("--prettylights-syntax-entityTag", "#7ee787");
    page.document.documentElement.style.setProperty("--prettylights-syntax-keyword", "#ff7b72");
    const lines = ["<html>", "\t<head>"];
    const body = `<section aria-labelledby="file-name-id">
      <div data-testid="code-cell"><span class="pl-kos">&lt;</span><span class="pl-ent">html</span><span class="pl-kos">&gt;</span></div>
      <div data-testid="code-cell">\t<span class="pl-kos">&lt;</span><span class="pl-ent">head</span><span class="pl-kos">&gt;</span></div>
    </section>{"tabSize":4,"rawLines":["wrong"],"stylingDirectives":[[[0,5,"pl-k"]]]}`;
    globalThis.fetch = async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    filePreview.run?.();
    click(page.window, page.document.querySelector("#file-row a")!);
    await flush();
    const texts = Array.from(page.document.querySelectorAll(".bgh-preview-text"), (node) => node.textContent);
    assert.deepEqual(texts, lines);
    assert.equal(page.document.querySelector(".bgh-preview-indent")?.textContent, "\t");
    const ent = page.document.querySelector<HTMLElement>(".pl-ent");
    assert.equal(ent?.textContent, "html");
    assert.match(ent?.style.color ?? "", /^(#7ee787|rgb\(\s*126,\s*231,\s*135\s*\))$/i);
    assert.equal(page.document.querySelector(".pl-k"), null);
    assert.equal((page.document.body.textContent ?? "").includes("·"), false);
    const code = page.document.querySelector<HTMLElement>(".bgh-preview-code");
    assert.ok(code);
    assert.equal(code.style.tabSize, "4");
    const range = page.document.createRange();
    range.selectNodeContents(code);
    const selection = page.window.getSelection();
    assert.ok(selection);
    selection.removeAllRanges();
    selection.addRange(range);
    let copied = "";
    const CopyEvent = (page.window as unknown as { Event: typeof Event }).Event;
    const event = new CopyEvent("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { setData(_type: string, value: string) { copied = value; } },
    });
    code.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(copied, "<html>\n\t<head>");
    assert.equal(copied.includes("1"), false);
  } finally {
    page.restore();
  }
});
