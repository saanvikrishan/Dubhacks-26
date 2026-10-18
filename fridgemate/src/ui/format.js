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
export const photoFor = (meal) =>
  meal.id.includes("pasta")
    ? "pasta"
    : meal.id.includes("chickpea")
      ? "chickpeas"
      : "tofu";
