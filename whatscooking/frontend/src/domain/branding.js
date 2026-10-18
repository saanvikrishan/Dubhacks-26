/** Canonical product identity, with read-through compatibility for existing browser data. */
export const BRAND = 'whatscooking.ai';
export const storageKeys = {
  state: `${BRAND}.local-demo.v1`,
  notes: `${BRAND}.sidebar-notes.v1`,
  user: `${BRAND}-user-id`,
  feedback: `${BRAND}-feedback-sent`,
  dismissed: `${BRAND}-dismissed-nudges`,
  voice: `${BRAND}-voice-replies`,
  prepared: `${BRAND}-pantry-prepared`,
};

// Legacy names are compatibility identifiers only, never presented as the product name.
const legacyKeys = {
  [storageKeys.state]: ['daywell.local-demo.v1'],
  [storageKeys.notes]: ['whatscooking.sidebar-notes.v1'],
  [storageKeys.user]: ['daywell-user-id'],
  [storageKeys.feedback]: ['daywell-feedback-sent'],
  [storageKeys.dismissed]: ['daywell-dismissed-nudges'],
  [storageKeys.voice]: ['daywell-voice-replies'],
  [storageKeys.prepared]: ['daywell-pantry-prepared'],
};

/** Copy existing data to its new key on first read; preserve the original as a fallback. */
export function readStored(storage, key) {
  const current = storage?.getItem(key);
  if (current != null) return current;
  for (const old of legacyKeys[key] ?? []) {
    const value = storage?.getItem(old);
    if (value != null) {
      try { storage?.setItem(key, value); } catch { /* A full/read-only store still permits the read. */ }
      return value;
    }
  }
  return null;
}

/** An explicit reset must also remove fallback keys so old state cannot reappear. */
export function removeStored(storage, key) {
  for (const name of [key, ...(legacyKeys[key] ?? [])]) storage.removeItem(name);
}

export const backendTarget = (env) => env.WHATSCOOKING_BACKEND_URL || env.WHATSCOOKING_DINING_BACKEND_URL
  || env.DAYWELL_BACKEND_URL || env.DAYWELL_DINING_BACKEND_URL || 'http://127.0.0.1:8000';
export const diningTarget = (env) => env.WHATSCOOKING_DINING_BACKEND_URL || env.WHATSCOOKING_BACKEND_URL
  || env.DAYWELL_DINING_BACKEND_URL || env.DAYWELL_BACKEND_URL || 'http://127.0.0.1:8000';
