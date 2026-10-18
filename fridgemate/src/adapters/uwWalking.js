import {useEffect, useSyncExternalStore} from "react";

/** Thin transport/store boundary, injectable for tests; route timestamps are never fabricated. */
export function createWalkingStore(fetchImpl = fetch) {
  let snapshot = {status:"not_requested",routes:[]};
  let pending;
  const listeners = new Set();
  const publish = value => {snapshot=value;for (const listener of listeners) listener();};
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {listeners.add(listener);return () => listeners.delete(listener);},
    tick() {if (snapshot.routes.length) publish({...snapshot});},
    refresh() {
      if (pending) return pending;
      publish({...snapshot,status:"loading"});
      pending = (async () => {
        try {
          const response = await fetchImpl("/api/dining/walking", {method:"POST",signal:AbortSignal.timeout(16000)});
          const value = await response.json();
          if (!response.ok || !Array.isArray(value.routes) || !["verified","partial"].includes(value.status)) throw new Error("unavailable");
          // A failed element does not erase the last retrieved fact. Consumers enforce expiry.
          const routes = value.routes.map(route => route.status === "verified" ? route
            : snapshot.routes.find(previous => previous.venueId === route.venueId && previous.status === "verified") ?? route);
          publish({...value,routes});
        } catch {publish({...snapshot,status:"unavailable"});}
      })().finally(() => {pending=null;});
      return pending;
    },
  };
}
const store = createWalkingStore();
export const refreshWalking = () => store.refresh();
export function useUwWalking() {
  const value = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    const timer = setInterval(store.tick,30000);
    return () => clearInterval(timer);
  },[]);
  return value;
}
