/**
 * server/models/domain.js - Canonical domain entities.
 */

import { z } from "zod";
import { SPOONS_BELOW_ML, cleanAmount, cleanAmountsInText, cleanCount, cleanSpoon, mlInTsp, toCelsiusInText } from "../scaling.js";

export const IngredientSchema = z.object({
  id: z.string().describe("Clean snake_case identifier (e.g. 'heavy_cream')"),
  name: z.string().describe("Display name (e.g. 'Heavy Cream')"),
  base_amount: z
    .number()
    .positive()
    .describe("Canonical quantity corresponding to Recipe.base_servings"),
  base_unit: z
    .enum(["g", "ml", "unit", "tsp", "tbsp", "pinch"])
    .describe("'g', 'ml', 'unit' (a count), or spoons for small amounts: 'tsp', 'tbsp', 'pinch' (1-2 only)"),
  substitutes: z
    .array(z.string())
    .default([])
    .describe("Direct ingredient replacements for Q&A answers"),
  optional: z
    .boolean()
    .default(false)
    .describe("The dish still works without it (answers 'do I need this?')"),
  whole: z
    .boolean()
    .default(false)
    .describe("A count that only comes whole (eggs, garlic cloves): never 0.3 egg, at least 1"),
});

export const StepSchema = z.object({
  index: z.number().int().nonnegative().describe("0-indexed sequence order"),
  title: z.string().describe("Concise action heading (e.g. 'Sear Chicken')"),
  instruction: z
    .string()
    .describe("Glanceable directive (<= 18 words) with each ingredient amount and unit"),
  visual_cues: z
    .array(z.string())
    .default([])
    .describe("What the step looks like when done, for answers and later camera step detection"),
  timer_sec: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .default(null)
    .describe("Active cooking timer in seconds"),
});

// Cuisines with their own cook's voice (ai/personas.js); anything else is "other".
export const CUISINES = ["indian", "chinese", "italian", "mexican", "french", "japanese", "thai", "other"];

export const RecipeSchema = z.object({
  recipe_id: z.string(),
  title: z.string(),
  base_servings: z.number().int().positive(),
  ingredients: z.array(IngredientSchema).nonempty(),
  steps: z.array(StepSchema).nonempty(),
  origin: z
    .enum(["library", "generated"])
    .default("library")
    .describe("'generated' = written by the AI for a cook; 'library' = from the removed server recipe files (older saved recipes)"),
  edits: z
    .array(z.string())
    .default([])
    .describe("Short notes on changes the AI made for this cook, oldest first"),
  servings: z
    .number()
    .int()
    .positive()
    .max(100)
    .nullable()
    .default(null)
    .describe("Servings the cook picked (the app's setting); amounts stay for base_servings"),
  source: z
    .object({ name: z.string() })
    .nullable()
    .default(null)
    .describe("The website the recipe was found on with Google Search (e.g. 'bbcgoodfood.com'), or null"),
  cuisine: z
    .enum(CUISINES)
    .nullable()
    .default(null)
    .describe("The dish's cuisine, named by /api/home: picks the cook's voice (ai/personas.js); null on older recipes"),
});

// What the AI writes when it creates or edits a recipe: the recipe without the fields the
// server owns (recipe_id, step index, origin, edits). toRecipe() turns it into a Recipe.
// The limits only stop runaways. Web recipes are long-winded ("Boneless skinless chicken
// breasts, cut into bite-sized pieces", a step naming every amount, a batch of 24 cookies),
// and a recipe that fails here goes to the fallback, so they sit well above normal sizes.
// The prompt asks for the short version (18-word steps).
export const RecipeDraftSchema = z.object({
  title: z.string().min(1).max(120),
  base_servings: z.number().int().positive().max(50),
  ingredients: z
    .array(IngredientSchema.omit({ id: true }).extend({ name: z.string().min(1).max(120) }))
    .min(1)
    .max(30),
  steps: z
    .array(StepSchema.omit({ index: true }).extend({ instruction: z.string().min(1).max(300) }))
    .min(1)
    .max(20),
});

/**
 * Builds a full Recipe from an AI draft: numbers the steps, gives ingredients unique ids
 * (reusing `previous` ids for ingredients whose name didn't change, so an edit doesn't
 * rename what it didn't touch), and sets the server-owned fields. Throws if the result
 * isn't a valid Recipe.
 */
export function toRecipe(draft, { recipe_id, origin, edits, previous, source = null, servings = null, cuisine = null }) {
  const parsed = tidy(RecipeDraftSchema.parse(draft));
  const previousIds = new Map((previous?.ingredients ?? []).map((ing) => [ing.name.toLowerCase(), ing.id]));
  const used = new Set();
  const ingredients = parsed.ingredients.map((ing) => {
    const kept = previousIds.get(ing.name.toLowerCase());
    const base =
      kept ?? (ing.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "ingredient");
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    return { id, ...ing };
  });
  const steps = parsed.steps.map((step, index) => ({ index, ...step }));
  return RecipeSchema.parse({ ...parsed, recipe_id, ingredients, steps, origin, edits, source, servings, cuisine });
}

// g/ml rounded as recipes write them; under 50 ml in spoons ("15 ml" → "1 tbsp"); spoons to
// ¼ tsp or ½ tbsp, more than 2 pinches as tsp; counts unchanged.
function cleanIngredientAmount(amount, unit, whole) {
  if (unit === "unit") return { base_amount: cleanCount(amount, whole), base_unit: unit };
  if (unit === "ml" && amount < SPOONS_BELOW_ML) {
    amount = mlInTsp(amount);
    unit = "tsp";
  }
  if (unit === "g" || unit === "ml") return { base_amount: cleanAmount(amount), base_unit: unit };
  const spoon = cleanSpoon(amount, unit);
  return { base_amount: spoon.amount, base_unit: spoon.unit };
}

// Counted ingredients that only come whole, whatever the AI says: eggs (and their yolks and
// whites), garlic cloves, bay leaves. The AI flags others (whole: true).
const ALWAYS_WHOLE = /\b(?:eggs?|egg (?:yolks?|whites?)|(?:garlic )?cloves?(?: of garlic)?|bay lea(?:f|ves))\b/i;

// Every AI recipe is tidied the same way, whether the AI wrote it, found it on the web or
// edited it: HTML entities copied from a web page decoded ("&#189; tsp" → "½ tsp"), temperatures in °C (the app converts for imperial; a web recipe in °F sometimes
// slips through) and g/ml amounts rounded as a recipe writer would ("113 g" → "110 g").
function tidy(raw) {
  const draft = decodeEntitiesIn(raw);
  const text = (s) => cleanAmountsInText(toCelsiusInText(s));
  return {
    ...draft,
    title: toCelsiusInText(draft.title),
    ingredients: draft.ingredients.map((ing) => {
      const whole = ing.base_unit === "unit" && (ing.whole || ALWAYS_WHOLE.test(ing.name));
      return { ...ing, name: text(ing.name), whole, ...cleanIngredientAmount(ing.base_amount, ing.base_unit, whole) };
    }),
    steps: draft.steps.map((step) => ({
      ...step,
      instruction: text(step.instruction),
      visual_cues: step.visual_cues.map(text),
    })),
  };
}

// HTML entities that a recipe copied from a web page can carry: numeric ones ("&#189;",
// "&#xBD;") and the named ones recipes use.
const NAMED_ENTITIES = {
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", deg: "°", frac12: "½", frac14: "¼",
  frac34: "¾", frac13: "⅓", frac23: "⅔", frac18: "⅛", ndash: "–", mdash: "—", times: "×",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", eacute: "é", egrave: "è",
  ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç",
};

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

// Every string in the draft, decoded.
function decodeEntitiesIn(value) {
  if (typeof value === "string") return decodeEntities(value);
  if (Array.isArray(value)) return value.map(decodeEntitiesIn);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeEntitiesIn(v)]));
  }
  return value;
}
