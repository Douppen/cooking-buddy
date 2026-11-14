/**
 * server/models/vision.js - Perception and VLM classification schemas.
 */

import { z } from "zod";

export const StepClassificationResultSchema = z.object({
  detected_step_index: z
    .number()
    .int()
    .nonnegative()
    .describe("Step index identified from the camera frame"),
  confidence: z
    .number()
    .min(0.0)
    .max(1.0)
    .describe("Confidence score of the classification"),
  visual_evidence: z
    .string()
    .describe("Brief description of visual cues identified in the frame"),
  transition_recommended: z
    .boolean()
    .default(false)
    .describe("Whether the engine should advance the active step"),
});
