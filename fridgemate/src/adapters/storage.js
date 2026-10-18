import { createDemoState, validateState } from "../domain/state.js";

export const STORAGE_KEY = "daywell.local-demo.v1";
const BACKEND_URL = "http://localhost:8000";

// Backend-connected storage adapter with localStorage fallback
export const storageAdapter = {
  async load(storage) {
    // Always load from localStorage — the backend uses append-only Backboard memory
    // which can return stale state if earlier saves failed or Backboard isn't connected.
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          state: validateState(parsed),
          error: null,
        };
      } else {
        return {
          state: createDemoState(),
          error: null,
        };
      }
    } catch {
      return {
        state: createDemoState(),
        error:
          "Saved data could not be read. It has been preserved. Reset the demo to start saving again.",
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
