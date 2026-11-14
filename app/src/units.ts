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
