export const CUISINES = ['Chinese','Indian','Italian','Japanese','Korean','Mexican','Mediterranean','Middle Eastern','Thai','Vietnamese','American'];
export const TASTES = ['Spicy','Mild','Savory','Sweet','Tangy','Fresh'];
const terms = value => String(value ?? '').toLowerCase().split(/[,;]+/).map(s=>s.trim()).filter(Boolean);
/** Goals picked in onboarding; each suggests daily nutrition targets the user can change later. */
export const GOALS = {
  muscle: {label: 'Build muscle', targets: [{nutrient: 'protein_g', mode: 'minimum', value: 120}]},
  lean: {label: 'Lose weight', targets: [{nutrient: 'energy_kcal', mode: 'maximum', value: 1800}, {nutrient: 'protein_g', mode: 'minimum', value: 90}]},
  healthy: {label: 'Eat healthier', targets: [{nutrient: 'fiber_g', mode: 'minimum', value: 28}, {nutrient: 'added_sugar_g', mode: 'maximum', value: 50}, {nutrient: 'sodium_mg', mode: 'maximum', value: 2300}]},
  energy: {label: 'Fuel my workouts', targets: [{nutrient: 'carbohydrate_g', mode: 'minimum', value: 250}, {nutrient: 'protein_g', mode: 'minimum', value: 100}]},
  budget: {label: 'Save money', targets: []},
  easy: {label: 'Just feed me', targets: []},
};
/** A profile with the goal set and its suggested targets (replacing earlier goal targets). */
export function withGoal(profile, goal) {
  if (goal !== '' && !GOALS[goal]) return profile;
  if (goal === (profile.goal ?? '')) return profile;
  const old = new Set((GOALS[profile.goal]?.targets ?? []).map((t) => t.nutrient));
  const targets = GOALS[goal]?.targets ?? [];
  const kept = (profile.goals ?? []).filter((g) => !old.has(g.nutrient) && !targets.some((t) => t.nutrient === g.nutrient));
  return {...profile, goal, goals: [...kept, ...targets], ...(goal === 'budget' && profile.budget > 7 ? {budget: 7} : {})};
}

export function foodPreferences(profile={}) {
  return {goal: GOALS[profile.goal] ? profile.goal : '', preferred: String(profile.preferred??'').slice(0,160), cuisines:(profile.cuisines??[]).filter(c=>CUISINES.includes(c)), tastes:(profile.tastes??[]).filter(t=>TASTES.includes(t)), dislikes:String(profile.dislikes??'').slice(0,160), avoidCuisines:(profile.avoidCuisines??[]).filter(c=>CUISINES.includes(c))};
}
const cues = {
  chinese:['chinese','fried rice','lo mein','chow mein','kung pao','mapo','dumpling','bok choy'], indian:['indian','dal','chana','masala','paneer','tikka','biryani'], italian:['italian','pasta','risotto','pizza','penne','marinara','pesto','lasagna'], japanese:['japanese','miso','soba','teriyaki','ramen','udon','sushi','katsu'], korean:['korean','kimchi','bibimbap','gochujang','bulgogi','japchae','tteok'], mexican:['mexican','taco','burrito','quesadilla','enchilada','salsa','tortilla'], mediterranean:['mediterranean','hummus','greek','tzatziki','feta'], 'middle eastern':['middle eastern','falafel','tahini','shawarma','za\'atar'], thai:['thai','pad thai','green curry','red curry','basil chicken'], vietnamese:['vietnamese','pho','banh mi','bun ','spring roll'], american:['american','burger','mac and cheese','bbq','sandwich'],
  spicy:['spicy','chili','chilli','sriracha'], mild:['mild'], savory:['savory','garlic','soy sauce','miso'], sweet:['sweet','honey','banana','berries'], tangy:['tangy','lemon','lime','yogurt'], fresh:['fresh','salad','cucumber'],
};
export function preferenceFit(meal,profile={}) {
  const text=`${meal.name} ${meal.description??''} ${(meal.ingredients??[]).map(i=>i.name).join(' ')} ${(meal.cuisines??[]).join(' ')} ${(meal.tastes??[]).join(' ')}`.toLowerCase();
  const includes=term=>text.includes(term);
  const matches=values=>(values??[]).some(value=>(cues[value.toLowerCase()]??[value.toLowerCase()]).some(includes));
  return {disliked:terms(profile.dislikes).some(includes),avoided:matches(profile.avoidCuisines),food:terms(profile.preferred).some(includes),cuisine:matches(profile.cuisines),taste:matches(profile.tastes)};
}
/** First cuisine of a meal: its label, else a name/ingredient cue. Used only for variety. */
export function cuisineOf(meal) {
  if(meal?.cuisines?.length) return String(meal.cuisines[0]).toLowerCase();
  return CUISINES.map(c=>c.toLowerCase()).find(c=>preferenceFit(meal,{cuisines:[c]}).cuisine) ?? null;
}
/** Learned Backboard signals in the same shape as a profile, so explicit rules can be reused. */
export function memoryProfile(preferences=[]) {
  const join=key=>preferences.map(p=>p[key]).filter(Boolean).join(', ');
  return {preferred:join('preferred'),cuisines:preferences.flatMap(p=>p.cuisines??[]),tastes:preferences.flatMap(p=>p.tastes??[]),dislikes:join('dislikes'),avoidCuisines:preferences.flatMap(p=>p.avoidCuisines??[])};
}
export function learnedProfile(learned) {
  if(!learned?.events) return [];
  return [{preferred:(learned.likedIngredients??[]).join(', '),cuisines:learned.likedCuisines??[],tastes:learned.likedTastes??[],avoidCuisines:learned.avoidCuisines??[],dislikes:(learned.repeatedlySkipped??[]).join(', '),source:'Backboard'}];
}
/** Keep the top picks varied: at most `limit` of one cuisine in the first `size`. */
export function varied(list, getMeal=r=>r.meal, size=3, limit=2) {
  const top=[],rest=[],count={};
  for(const item of list) {
    const cuisine=cuisineOf(getMeal(item));
    if(top.length<size && (!cuisine || (count[cuisine]??0)<limit)) {top.push(item);if(cuisine)count[cuisine]=(count[cuisine]??0)+1;}
    else rest.push(item);
  }
  return [...top,...rest];
}
export function comparePreferences(a,b,profile) {
  const x=preferenceFit(a,profile),y=preferenceFit(b,profile);
  return Number(x.disliked||x.avoided)-Number(y.disliked||y.avoided)||Number(y.food)-Number(x.food)||Number(y.cuisine)-Number(x.cuisine)||Number(y.taste)-Number(x.taste);
}
