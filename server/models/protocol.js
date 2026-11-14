/**
 * server/models/protocol.js - Tagged { t: string, ... } message schemas.
 *
 * Written for the WebSocket relay, which was removed on 2026-11-14 (see "Porting notes" in
 * CLAUDE.md). Only HudSyncMessageSchema is still used, by engine.js to validate HUD state.
 */

import { z } from "zod";
import { StepSchema } from "./domain.js";

// Glasses -> Phone: user asks a question or triggers a snapshot analysis
export const SnapMessageSchema = z.object({
  t: z.literal("snap"),
  question: z
    .string()
    .describe("User speech or context query (e.g. 'is the onion done?')"),
  step_index: z.number().int().nonnegative().optional(),
});

// Phone/Backend -> Glasses: text answer to be displayed or spoken via TTS
export const AnswerMessageSchema = z.object({
  t: z.literal("answer"),
  text: z.string().describe("Concise speech response (<= 2 sentences)"),
});

// Full HUD state broadcast to synchronize glasses and phone viewports
export const HudSyncMessageSchema = z.object({
  t: z.literal("hud_sync"),
  recipe_title: z.string(),
  target_servings: z.number().int().positive(),
  unit_system: z.enum(["metric", "imperial"]),
  active_step_index: z.number().int().nonnegative(),
  total_steps: z.number().int().positive(),
  current_step: StepSchema,
  display_ingredients: z.array(z.string()),
});

// Action message to navigate or update settings across peers
export const ControlMessageSchema = z.object({
  t: z.literal("control"),
  action: z.enum(["next_step", "prev_step", "toggle_units", "set_servings"]),
  value: z.union([z.number(), z.string()]).optional(),
});

// Combined union of all valid messages passing through the server relay
export const WsMessageSchema = z.discriminatedUnion("t", [
  SnapMessageSchema,
  AnswerMessageSchema,
  HudSyncMessageSchema,
  ControlMessageSchema,
]);
