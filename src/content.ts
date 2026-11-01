// Content script on github.com: runs every enabled feature; one failing
// doesn't stop the others.
import { disabledIds } from "./feature";
import { features } from "./features";

void (async () => {
  const disabled = await disabledIds();
  for (const feature of features) {
    if (disabled.has(feature.id)) continue;
    try {
      feature.run();
    } catch (error) {
      console.error(`[Buffed GitHub] ${feature.id}:`, error);
    }
  }
})();
