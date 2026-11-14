// Sends the shopping list to the cook's phone ("send the shopping list to my phone", while
// cooking): the ingredient list, scaled to their servings and in their units, as a push
// notification through ntfy (https://ntfy.sh: free, no account). The phone runs the ntfy app
// subscribed to NTFY_TOPIC, a hard-to-guess name: anyone who knows it can read the lists, so
// it's kept out of the public eye (config/deploy.yml in a private repo). Without NTFY_TOPIC
// the feature says no phone is connected.

import { convertUnitSystem, scaleIngredients } from "./scaling.js";

const NTFY_URL = process.env.NTFY_URL ?? "https://ntfy.sh";
const TOPIC = process.env.NTFY_TOPIC ?? "";
const SEND_TIMEOUT_MS = 8_000;

export const phoneConnected = () => Boolean(TOPIC);

/**
 * The list as the notification shows it: a title ("Lasagna, 4 servings") and one line per
 * ingredient, optional ones marked.
 * @param {object} recipe  a Recipe (models/domain.js)
 * @param {number} servings
 * @param {"metric" | "imperial"} unitSystem
 */
export function shoppingList(recipe, servings, unitSystem = "metric") {
  const shown = convertUnitSystem(scaleIngredients(recipe.ingredients, servings / recipe.base_servings), unitSystem);
  const lines = recipe.ingredients.map((ing, i) => `• ${shown[i].display}${ing.optional ? " (optional)" : ""}`);
  return { title: `${recipe.title}, ${servings} ${servings === 1 ? "serving" : "servings"}`, message: lines.join("\n") };
}

/** Posts the list to the phone. Throws when ntfy doesn't take it. */
export async function sendToPhone({ title, message }) {
  if (!TOPIC) throw new Error("NTFY_TOPIC isn't set");
  // JSON publishing, so titles with accents (crème brûlée) arrive intact.
  const res = await fetch(NTFY_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic: TOPIC, title, message, tags: ["shopping_cart"] }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ntfy answered ${res.status}`);
}
