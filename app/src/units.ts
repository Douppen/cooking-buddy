// Metric or imperial amounts, as the cook picks with the switch on the Recipes screen.
// Recipes are always stored in metric: ingredient amounts in g, ml or counts, and step text
// as the AI wrote it ("Bake at 200°C", "Cut into 2 cm cubes"). The choice only changes what
// is shown, so switching back and forth loses nothing. Plain TypeScript, no DOM or React:
// the spec for the native port. server/scaling.js formats ingredient amounts with the same
// rules for the AI, so spoken answers use the amounts the cook sees.

export type UnitSystem = 'metric' | 'imperial';

/** How a recipe stores an amount: g, ml, a count, or spoons and pinches (same in both systems). */
export type BaseUnit = 'g' | 'ml' | 'unit' | 'tsp' | 'tbsp' | 'pinch';

/** An amount to show: "250" + "g", "8.8" + "oz", "1¼" + "cups", or "2" + "" for a count. */
export interface Measure {
  amount: string;
  unit: string;
}

const G_PER_OZ = 28.3495;
const ML_PER_TSP = 4.92892;
const ML_PER_TBSP = 14.7868;
const ML_PER_CUP = 236.588;
const CM_PER_INCH = 2.54;

// The fractions on measuring spoons, cups and rulers. [value, glyph]; 0 and 1 have none.
type Fractions = ReadonlyArray<readonly [number, string]>;
const QUARTERS: Fractions = [[0, ''], [1 / 4, '¼'], [1 / 2, '½'], [3 / 4, '¾'], [1, '']];
const CUP_FRACTIONS: Fractions = [[0, ''], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'], [1, '']];
const HALVES: Fractions = [[0, ''], [1 / 2, '½'], [1, '']];
const SMALL_INCHES: Fractions = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼']];

/**
 * An ingredient amount in the cook's unit system. Metric is shown as stored, to one decimal.
 * Imperial: grams become oz (lb from about 1 lb up); millilitres become tsp below 1 tbsp, tbsp
 * below ¼ cup, then cups, in the fractions a measuring set has. Counts never change.
 */
export function measure(amount: number, unit: BaseUnit, system: UnitSystem): Measure {
  if (unit === 'tsp' || unit === 'tbsp' || unit === 'pinch') return spoons(amount, unit);
  if (unit === 'unit') return {amount: decimal(amount, 1), unit: ''};
  if (system === 'metric') {
    // Scaled amounts get the same tidy numbers as stored ones (cleanAmount), and small liquid
    // amounts read as spoons: 30 ml → 2 tbsp. server/scaling.js does the same for answers.
    if (unit === 'ml' && amount < SPOONS_BELOW_ML) return spoons(amount / ML_PER_METRIC_TSP, 'tsp');
    return {amount: String(cleanAmount(amount)), unit};
  }
  if (unit === 'g') {
    const oz = amount / G_PER_OZ;
    if (oz >= 15.5) return {amount: decimal(oz / 16, 1), unit: 'lb'};
    return {amount: oz >= 10 ? decimal(oz, 0) : decimal(Math.max(oz, 0.1), 1), unit: 'oz'};
  }
  const tsp = amount / ML_PER_TSP;
  if (tsp < 2.875) return {amount: fraction(tsp, QUARTERS), unit: 'tsp'};
  const tbsp = amount / ML_PER_TBSP;
  if (tbsp < 3.75) return {amount: fraction(tbsp, HALVES), unit: 'tbsp'};
  const cups = amount / ML_PER_CUP;
  const shown = fraction(cups, cups < 4 ? CUP_FRACTIONS : QUARTERS);
  return {amount: shown, unit: cups < 1.125 ? 'cup' : 'cups'};
}

/** Under this many ml, a metric amount is shown in spoons (a metric tsp is 5 ml). */
const SPOONS_BELOW_ML = 50;
const ML_PER_METRIC_TSP = 5;

/**
 * A g or ml amount rounded the way recipes write them: under 5 to the half, 5–10 to the
 * whole, 10–100 to 5, 100–1000 to 10, above that to 50; multiples of 25 from 100 up stay.
 * 27.5 → 30, 113 → 110, 125 → 125. Same as cleanAmount() in server/scaling.js.
 */
export function cleanAmount(amount: number): number {
  if (amount >= 100 && amount % 25 === 0) return amount;
  const step = amount < 5 ? 0.5 : amount < 10 ? 1 : amount < 100 ? 5 : amount < 1000 ? 10 : 50;
  return Math.max(Math.round(amount / step) * step, step);
}

/**
 * Spoons and pinches, the same in both unit systems: tsp in quarters, tbsp in halves, 3 tsp
 * or more as tbsp, under 1 tbsp as tsp. A pinch is only ever 1 or 2; more (from scaling up)
 * becomes tsp, 16 pinches to the tsp. server/scaling.js spoons() follows the same rules.
 */
export function spoons(amount: number, unit: 'tsp' | 'tbsp' | 'pinch'): Measure {
  if (unit === 'pinch') {
    if (amount <= 2.5) {
      const pinches = Math.max(1, Math.round(amount));
      return {amount: String(pinches), unit: pinches === 1 ? 'pinch' : 'pinches'};
    }
    return spoons(amount / 16, 'tsp');
  }
  const tsp = unit === 'tbsp' ? amount * 3 : amount;
  if (tsp < 2.875) return {amount: fraction(tsp, QUARTERS), unit: 'tsp'};
  return {amount: fraction(tsp / 3, HALVES), unit: 'tbsp'};
}

/** "250 g", "1¼ cups", or "2" for a count. */
export function measureText(amount: number, unit: BaseUnit, system: UnitSystem): string {
  const shown = measure(amount, unit, system);
  return shown.unit ? `${shown.amount} ${shown.unit}` : shown.amount;
}

// A metric quantity in text: a number or a range ("2-3", "150–200", "1 to 2"), then a unit.
// A decimal comma takes at most two digits, so "1,000 g" (a thousands separator) is left as is.
const NUMBER = String.raw`\d+(?:\.\d+|,\d{1,2}(?!\d))?`;
const METRIC_IN_TEXT = new RegExp(
  String.raw`(?<![\d.,])(${NUMBER})(?:\s*(?:-|–|to)\s*(${NUMBER}))?\s*` +
    String.raw`(°\s*C|º\s*C|degrees\s+C(?:elsius)?|kg|g|ml|cl|dl|l|cm|mm)\b`,
  'gi',
);

const ML_PER: Record<string, number> = {ml: 1, cl: 10, dl: 100, l: 1000};

// --- Scaling amounts in step text -------------------------------------------------------
// Steps name their amounts ("Add 140 g butter and 2 eggs"), for the recipe's base servings.
// For the cook's servings, scale the numbers that are amounts: a number with a unit, or a
// count followed by a counted ingredient ("2 garlic cloves"). Times, temperatures and sizes
// ("10 min", "180°C", "2 cm") have no such unit or ingredient after them and stay.

// A number as the server writes it: "140", "1.5", "½", "1½".
const AMOUNT = String.raw`\d+(?:\.\d+)?[¼½¾⅓⅔]?|[¼½¾⅓⅔]`;
const GLYPHS: Record<string, number> = {'¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3};
const SCALABLE_IN_TEXT = new RegExp(
  String.raw`(?<![\d.,¼½¾⅓⅔])(${AMOUNT})(?:\s*(?:-|–|to)\s*(${AMOUNT}))?` +
    String.raw`(?:\s*(kg|g|ml|l|tsp|tbsp|pinch(?:es)?)\b|((?:\s+[A-Za-z][\w'-]*){1,3}))`,
  'g',
);
// Words that don't identify a counted ingredient ("2 large eggs": "eggs" does).
const NOT_INGREDIENT_WORDS = new Set(['large', 'small', 'medium', 'fresh', 'ripe', 'whole', 'very', 'and', 'the', 'of']);
// Units and other words after a number that is not an amount to scale.
const NOT_COUNT_WORDS = new Set(['min', 'mins', 'minute', 'minutes', 'hour', 'hours', 'sec', 'secs', 'seconds', 'cm', 'mm', 'in', 'inch', 'inches', 'degrees']);

function amountValue(text: string): number {
  const glyph = text.slice(-1);
  if (GLYPHS[glyph] !== undefined) return Number(text.slice(0, -1) || 0) + GLYPHS[glyph];
  return Number(text);
}

/** A noun's singular, lowercase: "eggs" → "egg", "cloves" → "clove", "cherries" → "cherry", "tomatoes" → "tomato". */
function nounSingular(word: string): string {
  const w = word.toLowerCase();
  if (/[^aeiou]ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(?:ch|sh|x|ss|zz|o)es$/.test(w)) return w.slice(0, -2);
  if (/[^s]s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** The noun in the number the count needs, keeping its capital: 1 → "egg", 2 → "eggs". */
function inflect(word: string, count: number): string {
  const one = nounSingular(word);
  let shown = one;
  if (count > 1) {
    if (/[^aeiou]y$/.test(one)) shown = one.slice(0, -1) + 'ies';
    else if (/(?:ch|sh|x|s|z)$/.test(one) || one === 'tomato' || one === 'potato') shown = one + 'es';
    else shown = one + 's';
  }
  return word[0] === word[0].toUpperCase() ? shown[0].toUpperCase() + shown.slice(1) : shown;
}

/**
 * The words that identify counted ingredients (base_unit 'unit'): "Garlic cloves, minced"
 * gives "garlic" and "clove". For scaleAmountsInText().
 */
export function countWords(ingredients: ReadonlyArray<{name: string; base_unit: string}>): string[] {
  return ingredients
    .filter(ing => ing.base_unit === 'unit')
    .flatMap(ing => ing.name.split(',')[0].toLowerCase().split(/[^a-z]+/))
    .filter(word => word.length >= 3 && !NOT_INGREDIENT_WORDS.has(word))
    .map(nounSingular);
}

/**
 * Step text with its amounts scaled by `factor` (cook's servings / base servings), written
 * like the ingredient list: "Add 140 g butter and 2 eggs" at ½ → "Add 70 g butter and 1
 * eggs". g and ml get cleanAmount() (ml under 50 as spoons), spoons and pinches spoons(),
 * counts one decimal. `counted` is countWords(recipe.ingredients). Factor 1: unchanged.
 */
export function scaleAmountsInText(text: string, factor: number, counted: readonly string[]): string {
  if (factor === 1) return text;
  return text.replace(
    SCALABLE_IN_TEXT,
    (match, first: string, second: string | undefined, unit: string | undefined, words: string | undefined) => {
      const values = (second === undefined ? [first] : [first, second]).map(v => amountValue(v) * factor);
      if (unit) {
        const shown = values.map(v => scaledMeasure(v, unit));
        if (shown.length === 2 && shown[0].unit === shown[1].unit) {
          return `${shown[0].amount}–${shown[1].amount} ${shown[1].unit}`;
        }
        return shown.map(m => `${m.amount} ${m.unit}`).join('–');
      }
      // A count: only if a counted ingredient follows, and not a time or size ("2 cm"). The
      // ingredient's noun follows the new number: "2 large eggs" at ½ → "1 large egg".
      const parts = (words ?? '').split(/(\s+)/); // words and the spaces between them
      const isIngredient = (part: string | undefined) => part !== undefined && counted.includes(nounSingular(part));
      let nounAt = parts.findIndex(isIngredient);
      // parts: ['', ' ', 'garlic', ' ', 'cloves']; the first word is parts[2].
      if (NOT_COUNT_WORDS.has(parts[2]?.toLowerCase() ?? '') || nounAt < 0) return match;
      // The noun ends the run of ingredient words: "garlic cloves", "cherry tomatoes".
      while (isIngredient(parts[nounAt + 2])) nounAt += 2;
      parts[nounAt] = inflect(parts[nounAt], Math.max(...values));
      return values.map(v => decimal(v, 1)).join('–') + parts.join('');
    },
  );
}

function scaledMeasure(amount: number, unit: string): Measure {
  if (unit === 'kg' || unit === 'l') return {amount: decimal(amount, 2), unit};
  if (unit === 'g' || unit === 'ml') return measure(amount, unit, 'metric');
  return spoons(amount, unit.startsWith('pinch') ? 'pinch' : (unit as 'tsp' | 'tbsp'));
}

/**
 * Text the AI wrote (step instructions, ingredient names) in the cook's unit system:
 * "Bake at 200°C" → "Bake at 400°F", "100 ml milk" → "½ cup milk", "2 cm cubes" → "¾ in
 * cubes". Metric returns the text unchanged.
 */
export function inUnitSystem(text: string, system: UnitSystem): string {
  if (system === 'metric') return text;
  return text.replace(METRIC_IN_TEXT, (match, first: string, second: string | undefined, rawUnit: string) => {
    const unit = rawUnit.toLowerCase().replace(/\s+/g, ' ');
    const values = second === undefined ? [parse(first)] : [parse(first), parse(second)];
    if (unit.startsWith('°') || unit.startsWith('º') || unit.startsWith('degrees')) {
      return `${values.map(fahrenheit).join('–')}°F`;
    }
    if (unit === 'cm' || unit === 'mm') {
      return joinRange(values.map(v => inches(unit === 'mm' ? v / 10 : v)));
    }
    if (unit === 'g' || unit === 'kg') {
      return joinRange(values.map(v => measure(unit === 'kg' ? v * 1000 : v, 'g', system)));
    }
    const mlPer = ML_PER[unit];
    return mlPer ? joinRange(values.map(v => measure(v * mlPer, 'ml', system))) : match;
  });
}

/** Oven and frying temperatures (300°F and up) to the nearest 25°F, like an oven dial. */
function fahrenheit(celsius: number): number {
  const f = (celsius * 9) / 5 + 32;
  return f >= 300 ? Math.round(f / 25) * 25 : Math.round(f);
}

function inches(cm: number): Measure {
  const value = cm / CM_PER_INCH;
  if (value >= 3) return {amount: decimal(value, 0), unit: 'in'};
  return {amount: fraction(value, value < 0.25 ? SMALL_INCHES : QUARTERS), unit: 'in'};
}

/** "2 tbsp", or a range in one unit ("⅔–¾ cup"), or two amounts ("14 oz–1.1 lb"). */
function joinRange(measures: Measure[]): string {
  const [low, high] = measures;
  if (!high) return `${low.amount} ${low.unit}`;
  if (singular(low.unit) === singular(high.unit)) return `${low.amount}–${high.amount} ${high.unit}`;
  return `${low.amount} ${low.unit}–${high.amount} ${high.unit}`;
}

function singular(unit: string): string {
  return unit === 'cups' ? 'cup' : unit;
}

function parse(number: string): number {
  return Number(number.replace(',', '.'));
}

function decimal(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/** "1¼", "⅔", "3": the nearest fraction from the set, never "0" (the smallest one instead). */
function fraction(value: number, fractions: Fractions): string {
  let whole = Math.floor(value);
  const rest = value - whole;
  let [part, glyph] = fractions[0];
  for (const candidate of fractions) {
    if (Math.abs(candidate[0] - rest) < Math.abs(part - rest)) [part, glyph] = candidate;
  }
  if (part === 1) whole += 1;
  if (whole === 0 && !glyph) return fractions[1][1];
  return `${whole || ''}${glyph}`;
}
