type SaveThunk = () => Promise<void>;

const pending: SaveThunk[] = [];

/** Register a cassette save to be flushed by the runner setup hook (record mode only). */
export function registerPendingSave(save: SaveThunk): void {
  pending.push(save);
}

/** Run and clear all pending saves. Safe to call when none are pending. */
export async function flushPendingSaves(): Promise<void> {
  const todo = pending.splice(0, pending.length);
  for (const save of todo) await save();
}
