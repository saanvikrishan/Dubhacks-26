import manifest from '../data/food/ingredient-matches.json' with {type:'json'};

/**
 * Maps a free-text ingredient ("2 large eggs", "onion, diced") to a reviewed USDA key.
 * Mirrored by resolve_name in backend/usda.py; both must pass tests/fixtures/ingredient-names.json.
 * Order: exact name or alias, then a documented default (returned as an assumption), then
 * singular/plural forms, then the same after dropping preparation words. Never fuzzy.
 */
const UNITS = 'g|grams?|kg|oz|ounces?|lbs?|pounds?|ml|l|cups?|tbsp|tablespoons?|tsp|teaspoons?|cloves?|pieces?|slices?|cans?|pinch(?:es)?|dash(?:es)?|handfuls?|bunch(?:es)?|stalks?';
const DESCRIPTORS = new Set(['fresh','chopped','diced','minced','sliced','grated','shredded','finely','roughly','thinly','coarsely','large','small','medium','boneless','skinless','peeled','organic','raw','uncooked','halved','cubed','julienned','trimmed','rinsed','drained','warm','cold','hot','boiling','lukewarm']);

export function buildNameIndex(source=manifest) {
  const names=new Map();
  for(const match of source.matches) for(const name of [match.key,...(match.aliases??[])]) names.set(name,match.key);
  return {names,defaults:source.defaults??{},unresolved:source.unresolved??{}};
}
const INDEX=buildNameIndex();

export function cleanIngredientName(name) {
  let text=String(name??'').toLowerCase().replace(/\([^)]*\)/g,' ').split(',')[0];
  let quantity=false;
  text=text.replace(/^\s*[\d½¼¾⅓⅔⅛][\d\s./½¼¾⅓⅔⅛-]*/,()=>{quantity=true;return ' ';});
  if(quantity) text=text.replace(new RegExp(`^\\s*(?:${UNITS})\\b\\.?(?:\\s+of)?\\s+`),' ');
  return text.replace(/\b(?:to taste|for garnish|optional|divided)\b/g,' ').replace(/\s+/g,' ').trim();
}

function forms(phrase) {
  const words=phrase.split(' '),last=words.pop(),stem=words.length?words.join(' ')+' ':'';
  const out=[];
  if(last.endsWith('ies')) out.push(last.slice(0,-3)+'y');
  if(last.endsWith('es')) out.push(last.slice(0,-2));
  if(last.endsWith('s')) out.push(last.slice(0,-1));
  if(last.endsWith('y')) out.push(last.slice(0,-1)+'ies');
  if(!last.endsWith('s')) out.push(last+'s',last+'es');
  return [phrase,...out.map(w=>stem+w)];
}

export function resolveIngredientName(name,{allowDefaults=true,index=INDEX}={}) {
  const cleaned=cleanIngredientName(name);
  const stripped=cleaned.split(' ').filter(w=>!DESCRIPTORS.has(w)).join(' ');
  for(const candidate of [...new Set([cleaned,stripped])].filter(Boolean)) {
    for(const form of forms(candidate)) {
      if(index.names.has(form)) return {key:index.names.get(form),assumption:null,cleaned};
      const choice=allowDefaults?index.defaults[form]:null;
      if(choice) return {key:choice.key,assumption:`For this recipe, ${form} means ${choice.note??choice.key}.`,cleaned};
    }
  }
  return {key:null,assumption:null,cleaned,hint:index.unresolved[cleaned]??index.unresolved[stripped]??null};
}
