// The octocat corner from arx, with its colors and size, in place of the header's menu button and logo,
// mirrored for the left edge. It links home, as the logo did, and waves on
// hover. The two buttons only turn invisible, so the header keeps its layout.
// The cat keeps arx's paths and 45° tilt, so it waves the same. As in arx its
// foot stands on the band's diagonal and it is drawn at arx's size (the band
// is 72px against arx's 80px, so the cat is scaled up by 80/72 inside it);
// here it is mirrored and slid along the diagonal a little past the middle,
// toward the top right. The band has no tail notch.
import type { Feature } from "../feature";
import css from "./github-corner.css";

// GitHub's app header: the React one (GlobalNav, with a CSS-module class like
// appHeader__6OmbvL) and the older Rails one.
const HEADER = 'header.GlobalNav, [class*="appHeader__"], .AppHeader';

const SVG = `<svg viewBox="0 0 250 250" aria-hidden="true">
  <path class="bgh-corner-band" d="M0 0H250L0 250z"/>
  <g transform="translate(277.0 -27.0) scale(-1.111 1.111)">
    <path class="bgh-corner-arm" d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2"/>
    <path class="bgh-corner-body" d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z"/>
  </g>
</svg>`;

let observer: MutationObserver | null = null;

/** Add the corner when the page has the app header and the corner is missing. */
function place(): void {
  if (!document.body || !document.querySelector(HEADER)) return;
  if (document.body.querySelector(":scope > .bgh-corner")) return;
  const corner = document.createElement("a");
  corner.className = "bgh-corner";
  corner.href = "/";
  corner.setAttribute("aria-label", "Homepage");
  // Markup is the constant above, nothing fetched.
  corner.innerHTML = SVG;
  document.body.append(corner);
}

const feature: Feature = {
  id: "github-corner",
  name: "GitHub corner",
  description: "The octocat corner in place of the header's menu button and logo.",
  css,
  run() {
    place();
    // The header can render after the HTML is parsed, and Turbo swaps the
    // whole <body> on navigation, taking the corner with it.
    observer?.disconnect();
    observer = new MutationObserver(place);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  },
};

export default feature;
