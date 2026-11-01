// Firefox content scripts get `content`: the page's own window, whose fetch
// sends requests as the page (with its cookies).
declare var content: (Window & typeof globalThis) | undefined;
