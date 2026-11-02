// Firefox content scripts get `content`: the page's own window, whose fetch
// sends requests as the page (with its cookies).
declare var content: (Window & typeof globalThis) | undefined;

// Feature styles live in .css files; build.js imports them as text.
declare module "*.css" {
  const css: string;
  export default css;
}
