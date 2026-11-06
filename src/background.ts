// Extension fetch, not the page's. In Firefox MV3 a content-script fetch is a
// page request, so GitHub's service worker can answer it without the file.
// Host permission applies here and the page service worker does not.

const BLOB_PATH = /^\/[^/]+\/[^/]+\/blob\/[^/]+\/.+$/;

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || message.type !== "buffed-github:file-html") return;
  const pathname = message.pathname;
  if (typeof pathname !== "string" || !BLOB_PATH.test(pathname)) {
    sendResponse({ ok: false, status: 0 });
    return;
  }
  fetch(`https://github.com${pathname}`, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "text/html" },
  })
    .then(async (res) => {
      if (!res.ok) {
        sendResponse({ ok: false, status: res.status });
        return;
      }
      sendResponse({ ok: true, html: await res.text() });
    })
    .catch(() => sendResponse({ ok: false, status: 0 }));
  return true;
});
