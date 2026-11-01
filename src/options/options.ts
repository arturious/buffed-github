// Options page: one switch per feature; changes apply on the next GitHub page
// load.
import { disabledIds, setEnabled } from "../feature";
import { features } from "../features";

void (async () => {
  const disabled = await disabledIds();
  const list = document.getElementById("features")!;
  for (const feature of features) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !disabled.has(feature.id);
    box.addEventListener("change", () => void setEnabled(feature.id, box.checked));
    const name = document.createElement("strong");
    name.textContent = feature.name;
    const description = document.createElement("small");
    description.textContent = feature.description;
    label.append(box, name, description);
    list.append(label);
  }
})();
