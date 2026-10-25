/** Browser storage for both studios. The instance studio reads the schema studio's state. */

import { DemoStateSchema } from "./api.js";
import type { DemoState } from "./state.js";

export const SCHEMA_STORAGE_KEY = "plaintype-studio-state-v4";
export const INSTANCE_STORAGE_KEY = "plaintype-instance-state-v1";

export function loadState(key: string): DemoState | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = DemoStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveState(key: string, state: DemoState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, blocked): the studios work without it.
  }
}
