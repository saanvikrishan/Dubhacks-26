export const CUISINES = ['Chinese','Indian','Italian','Japanese','Korean','Mexican','Mediterranean','Middle Eastern','Thai','Vietnamese','American'];
export const TASTES = ['Spicy','Mild','Savory','Sweet','Tangy','Fresh'];
const terms = value => String(value ?? '').toLowerCase().split(/[,;]+/).map(s=>s.trim()).filter(Boolean);
export function foodPreferences(profile={}) {
  return {preferred: String(profile.preferred??'').slice(0,160), cuisines:(profile.cuisines??[]).filter(c=>CUISINES.includes(c)), tastes:(profile.tastes??[]).filter(t=>TASTES.includes(t)), dislikes:String(profile.dislikes??'').slice(0,160)};
}
const cues = {
  chinese:['chinese','fried rice'], indian:['indian','dal','chana','masala'], italian:['italian','pasta','risotto','pizza'], japanese:['japanese','miso','soba','teriyaki'], korean:['korean','kimchi','bibimbap'], mexican:['mexican','taco','burrito','quesadilla'], mediterranean:['mediterranean','hummus','greek'], 'middle eastern':['middle eastern','falafel','tahini'], thai:['thai','pad thai'], vietnamese:['vietnamese','pho','banh mi'], american:['american','burger'],
  spicy:['spicy','chili','chilli','sriracha'], mild:['mild'], savory:['savory','garlic','soy sauce','miso'], sweet:['sweet','honey','banana','berries'], tangy:['tangy','lemon','lime','yogurt'], fresh:['fresh','salad','cucumber'],
};
export function preferenceFit(meal,profile={}) {
  const text=`${meal.name} ${meal.description??''} ${(meal.ingredients??[]).map(i=>i.name).join(' ')} ${(meal.cuisines??[]).join(' ')} ${(meal.tastes??[]).join(' ')}`.toLowerCase();
  const includes=term=>text.includes(term);
  const matches=values=>(values??[]).some(value=>(cues[value.toLowerCase()]??[value.toLowerCase()]).some(includes));
  return {disliked:terms(profile.dislikes).some(includes),food:terms(profile.preferred).some(includes),cuisine:matches(profile.cuisines),taste:matches(profile.tastes)};
}
export function comparePreferences(a,b,profile) {
  const x=preferenceFit(a,profile),y=preferenceFit(b,profile);
  return Number(x.disliked)-Number(y.disliked)||Number(y.food)-Number(x.food)||Number(y.cuisine)-Number(x.cuisine)||Number(y.taste)-Number(x.taste);
}
