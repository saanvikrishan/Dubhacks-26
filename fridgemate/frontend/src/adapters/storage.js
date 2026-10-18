import {foodPreferences} from "../domain/preferences.js";
import { createDemoState, validateState } from "../domain/state.js";

export const STORAGE_KEY = "daywell.local-demo.v1";
const BACKEND_URL = "/api";

// Backend-connected storage adapter with localStorage fallback
export const storageAdapter = {
  load(storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return { state: createDemoState(), error: null };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // JSON is corrupt — preserve the raw string and start fresh.
      return {
        state: createDemoState(),
        error: "Saved data was unreadable and has been reset.",
      };
    }
    // validateState now repairs recoverable issues (stale context, bad grams, etc.)
    // instead of throwing, so your pantry/profile/logs are always preserved.
    try {
      return { state: validateState(parsed), error: null };
    } catch (err) {
      // Only truly unrecoverable corruption reaches here (wrong version, etc.).
      // Keep the broken raw data in storage — don't silently wipe it.
      return {
        state: createDemoState(),
        error: `Saved data could not be loaded (${err.message}). Reset the demo to start fresh.`,
      };
    }
  },
  
  save(storage, state) {
    const validatedState = validateState(state);
    
    
    let previousProfile;
    try {previousProfile=JSON.parse(storage.getItem(STORAGE_KEY))?.profile;} catch { /* Preserve local saving if old data was malformed. */ }
    storage.setItem(STORAGE_KEY, JSON.stringify(validatedState));
    if (typeof window !== "undefined" && JSON.stringify(foodPreferences(previousProfile))!==JSON.stringify(foodPreferences(validatedState.profile))) void mirrorToBackboard(validatedState.profile);
    return true;
  },

  reset(storage) {
    storage.removeItem(STORAGE_KEY);
    // Note: Backend memories are preserved. To clear backend, implement a DELETE endpoint
    return createDemoState();
  },
  
  status: {
    provider: "browser-localStorage",
    description: "Meal plans and logs stay in this browser. They are not synced across devices.",
    multiUser: false,
    synchronized: false,
  },
};

let backboardConfigured = null;
async function mirrorToBackboard(profile) {
  try {
    if (backboardConfigured === null) {
      const status = await fetch("/api/backend-status", { signal: AbortSignal.timeout(1500) });
      const data = status.ok ? await status.json() : {};
      backboardConfigured = data.backboard === true;
    }
    if (!backboardConfigured) return;
    const response=await fetch(`${BACKEND_URL}/preferences`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `Food preferences: ${JSON.stringify(foodPreferences(profile))}`,
        metadata: {type:'food_preferences',profile:foodPreferences(profile),savedAt:new Date().toISOString()},
      }),
      signal: AbortSignal.timeout(10000),
    });
    const result=await response.json();
    window.dispatchEvent(new CustomEvent('daywell-preferences-synced',{detail:{status:response.ok&&result.status!=='local_only'?'saved':'local_only'}}));
  } catch {
    window.dispatchEvent(new CustomEvent('daywell-preferences-synced',{detail:{status:'local_only'}}));
    // The local save already succeeded. A failed mirror does not roll it back.
  }
}
