import {useEffect,useSyncExternalStore} from 'react';
import {getFoodReference,installFoodReference} from '../domain/foodFacts.js';
import {learnedProfile} from '../domain/preferences.js';
import {getUserId} from './mealFeedback.js';
export function createFoodReferenceStore(fetchImpl=fetch) {
  let state={status:'not_requested',reference:getFoodReference(),preferences:[],preferenceStatus:'not_requested'},pending,expires=0;
  const listeners=new Set();
  const publish=next=>{state=next;for(const listener of listeners)listener();};
  return {getSnapshot:()=>state,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    refresh(force=false){
      if(pending)return pending;
      if(!force && expires>Date.now())return Promise.resolve(state);
      publish({...state,status:'loading'});
      pending=(async()=>{
        try {
          const response=await fetchImpl('/api/food/reference?location_id=70500807',{signal:AbortSignal.timeout(25000)});
          if(!response.ok)throw Error('Food references unavailable');
          const reference=installFoodReference(await response.json());
          expires=Date.now()+Math.min(600000,Math.max(30000,...Object.values(reference.pricing).map(q=>Date.parse(q.expiresAt)-Date.now()-60000)));
          publish({...state,status:'ready',reference});
        } catch {expires=Date.now()+30000;publish({...state,status:'unavailable'});}
        return state;
      })().finally(()=>{pending=null;});
      return pending;
    },
    async recall(force=false){
      if(!force&&!['not_requested','unavailable'].includes(state.preferenceStatus))return;
      try {
        // Learned signals come only from this browser user's own Backboard memory.
        const user=getUserId();
        const response=await fetchImpl(`/api/food/preferences${user?`?user=${user}`:''}`,{signal:AbortSignal.timeout(12000)});
        const data=await response.json();
        publish({...state,preferences:response.ok?learnedProfile(data.learned):[],learned:response.ok?data.learned??null:null,preferenceStatus:data.status??'unavailable'});
      } catch {publish({...state,preferenceStatus:'unavailable'});}
    }
  };
}
const store=createFoodReferenceStore();
export const refreshFoodReference=()=>store.refresh(true);
export function useFoodReference(){
  const value=useSyncExternalStore(store.subscribe,store.getSnapshot);
  useEffect(()=>{void store.refresh();void store.recall();const recalled=()=>{void store.recall(true);};window.addEventListener('whatscooking.ai-preferences-synced',recalled);window.addEventListener('whatscooking.ai-feedback-saved',recalled);const timer=setInterval(()=>{void store.refresh();},60000);return()=>{clearInterval(timer);window.removeEventListener('whatscooking.ai-preferences-synced',recalled);window.removeEventListener('whatscooking.ai-feedback-saved',recalled);};},[]);
  return value;
}
