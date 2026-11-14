/**
 * server/models/domain.js - Canonical domain entities.
 */

import { z } from "zod";

export const IngredientSchema = z.object({
  id: z.string().describe("Clean snake_case identifier (e.g. 'heavy_cream')"),
  name: z.string().describe("Display name (e.g. 'Heavy Cream')"),
  base_amount: z
    .number()
    .positive()
    .describe("Canonical quantity corresponding to Recipe.base_servings"),
  base_unit: z
    .enum(["g", "ml", "unit"])
    .describe("Normalized metric unit: 'g', 'ml', or 'unit'"),
  substitutes: z
    .array(z.string())
    .default([])
    .describe("Direct ingredient replacements for Q&A answers"),
});

export const StepSchema = z.object({
  index: z.number().int().nonnegative().describe("0-indexed sequence order"),
  title: z.string().describe("Concise action heading (e.g. 'Sear Chicken')"),
  instruction: z
    .string()
    .describe("Glanceable directive (<= 15 words) for glasses HUD"),
  visual_cues: z
    .array(z.string())
    .default([])
    .describe("Visual anchors for VLM state classifier"),
  timer_sec: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .default(null)
    .describe("Active cooking timer in seconds"),
});

export const RecipeSchema = z.object({
  recipe_id: z.string(),
  title: z.string(),
  base_servings: z.number().int().positive(),
  ingredients: z.array(IngredientSchema).nonempty(),
  steps: z.array(StepSchema).nonempty(),
});
