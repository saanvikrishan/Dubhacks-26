import { createDemoState, validateState } from "../domain/state.js";
export const STORAGE_KEY = "daywell.local-demo.v1";
export const storageAdapter = {
  load(storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      return {
        state: raw ? validateState(JSON.parse(raw)) : createDemoState(),
        error: null,
      };
    } catch {
      return {
        state: createDemoState(),
        error:
          "Saved data could not be read. It has been preserved. Reset the demo to start saving again.",
      };
    }
  },
  save(storage, state) {
    storage.setItem(STORAGE_KEY, JSON.stringify(validateState(state)));
  },
  reset(storage) {
    storage.removeItem(STORAGE_KEY);
    return createDemoState();
  },
  status: {
    provider: "browser-local-demo",
    multiUser: false,
    synchronized: false,
  },
};
