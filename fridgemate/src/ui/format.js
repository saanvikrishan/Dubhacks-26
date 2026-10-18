import { minutes } from "../domain/engine.js";
export const money = (n) => (n == null ? "Unknown price" : `$${n.toFixed(2)}`);
export const num = (n) =>
  n == null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
export const niceTime = (t) => {
  const m = minutes(t);
  return `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} ${m >= 720 ? "PM" : "AM"}`;
};

const PHOTOS = ["pasta", "chickpeas", "tofu"];
const PHOTO_SIGNALS = {
  pasta: [
    ["penne", 6],
    ["spaghetti", 6],
    ["linguine", 6],
    ["fettuccine", 6],
    ["macaroni", 6],
    ["lasagna", 6],
    ["ravioli", 6],
    ["pasta", 5],
    ["noodle", 4],
    ["carbonara", 4],
    ["alfredo", 4],
    ["bolognese", 4],
    ["marinara", 3],
    ["arrabbiata", 4],
    ["tomato sauce", 3],
  ],
  chickpeas: [
    ["chickpea", 6],
    ["garbanzo", 6],
    ["hummus", 6],
    ["falafel", 5],
    ["chana", 5],
    ["tzatziki", 4],
    ["mediterranean", 3],
    ["cucumber", 2],
    ["lentil", 3],
    ["dal", 3],
    ["bean salad", 3],
    ["black bean", 2],
    ["kidney bean", 2],
    ["white bean", 2],
    ["bean", 2],
  ],
  tofu: [
    ["tofu", 6],
    ["tempeh", 5],
    ["stir-fry", 4],
    ["stir fry", 4],
    ["teriyaki", 4],
    ["sesame", 2],
    ["buddha bowl", 4],
    ["grain bowl", 2],
    ["rice bowl", 3],
    ["broccoli", 2],
    ["edamame", 3],
  ],
};

/** Pick stock photo that best matches the dish name / ingredients. */
export function photoFor(meal) {
  if (!meal) return "tofu";
  const name = String(meal.name || "").toLowerCase();
  const desc = String(meal.description || "").toLowerCase();
  const rest = [
    ...(meal.ingredients || []).map((i) =>
      typeof i === "string" ? i : i?.name || "",
    ),
    ...(meal.steps || []),
    meal.id || "",
  ]
    .join(" ")
    .toLowerCase();

  const scores = Object.fromEntries(PHOTOS.map((k) => [k, 0]));
  for (const [key, signals] of Object.entries(PHOTO_SIGNALS)) {
    for (const [token, weight] of signals) {
      if (name.includes(token)) scores[key] += weight * 3;
      if (desc.includes(token)) scores[key] += weight * 2;
      if (rest.includes(token)) scores[key] += weight;
    }
  }

  const hinted = PHOTOS.includes(meal.photo) ? meal.photo : null;
  if (hinted) scores[hinted] += 1;

  let best = "tofu";
  let bestScore = -1;
  for (const key of PHOTOS) {
    if (scores[key] > bestScore) {
      bestScore = scores[key];
      best = key;
    }
  }
  return bestScore > 0 ? best : hinted || "tofu";
}
