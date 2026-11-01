// What every file in src/features/ exports, and the on/off state the options
// page keeps for each one.

export interface Feature {
  /** Stable key, stored in settings: don't rename once released. */
  id: string;
  /** Shown on the options page. */
  name: string;
  description: string;
  /** Called once per GitHub page load, if the feature is on. */
  run(): void;
}

// Every feature is on unless switched off on the options page.
export async function disabledIds(): Promise<Set<string>> {
  const { disabled = [] } = (await browser.storage.sync.get("disabled")) as { disabled?: string[] };
  return new Set(disabled);
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const disabled = await disabledIds();
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  await browser.storage.sync.set({ disabled: [...disabled] });
}
