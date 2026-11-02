// Content script on github.com, injected as the page starts loading: the
// enabled features' CSS goes in right away (no flash of unstyled GitHub),
// their scripts run once the HTML is parsed. One failing doesn't stop the
// others.
import { disabledIds } from "./feature";
import { features } from "./features";

function whenParsed(callback: () => void): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback, { once: true });
  } else {
    callback();
  }
}

void (async () => {
  const disabled = await disabledIds();
  const enabled = features.filter((feature) => !disabled.has(feature.id));

  for (const feature of enabled) {
    if (!feature.css) continue;
    const style = document.createElement("style");
    style.dataset.buffedGithub = feature.id;
    style.textContent = feature.css;
    // <head> may not exist yet this early
    document.documentElement.append(style);
  }

  whenParsed(() => {
    for (const feature of enabled) {
      try {
        feature.run?.();
      } catch (error) {
        console.error(`[Buffed GitHub] ${feature.id}:`, error);
      }
    }
  });
})();
