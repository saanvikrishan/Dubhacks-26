import { createDemoState, validateState } from "../domain/state.js";

export const STORAGE_KEY = "daywell.local-demo.v1";
const BACKEND_URL = "http://localhost:8000";

// Backend-connected storage adapter with localStorage fallback
export const storageAdapter = {
  async load(storage) {
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
  
  async save(storage, state) {
    const validatedState = validateState(state);
    
    
    // Save to localStorage as backup
    storage.setItem(STORAGE_KEY, JSON.stringify(validatedState));
    
    // Try to save to backend
    try {
      const response = await fetch(`${BACKEND_URL}/preferences`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: `App state updated at ${new Date().toISOString()}`,
          metadata: {
            type: 'app_state',
            state: validatedState,
            timestamp: new Date().toISOString(),
          },
        }),
      });
      
      if (response.ok) {
        return true; // Successfully saved to backend
      } else {
        return false;
      }
    } catch (error) {
      return false;
    }
  },
  
  reset(storage) {
    storage.removeItem(STORAGE_KEY);
    // Note: Backend memories are preserved. To clear backend, implement a DELETE endpoint
    return createDemoState();
  },
  
  status: {
    provider: "backend-with-localStorage-fallback",
    multiUser: false,
    synchronized: true,
  },
};
