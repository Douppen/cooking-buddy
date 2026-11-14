// POST /api/speak: an answer read aloud, for the glasses' speaker.
//
// Request (JSON):  { text: "Add the cream now.", cuisine?: "indian", context?: "Butter Chicken" }
//   text: what to say (up to 600 characters). cuisine: the recipe's cuisine (recipe.cuisine,
//   from /api/home), whose cook reads it (ai/personas.js: "indian" is Pankaj). context: the
//   recipe title, for older recipes without a cuisine (Italian titles get Giuseppe). Neither (as
//   on home): the British chef.
// Response:        200 audio/mpeg (MP3); headers x-persona: "chef" | "indian" | ..., and
//                  x-voice: "character" (the cook's own voice) or "fallback" (a plain
//                  voice, when the character voice failed). 503 { error } when speech isn't configured, 502 { error }
//                  when Google fails.
//
// The app fetches this as soon as it has an answer and shows the answer when its voice
// starts; if it fails, the app falls back to the device's own voice. The native app plays
// the same MP3.

import { z } from "zod";
import { personaFor } from "./ai/personas.js";
import { speechConfigured, synthesize } from "./ai/speech.js";
import { CUISINES } from "./models/domain.js";
import { createRateLimiter, readJsonRequest, sendJson } from "./http.js";

const MAX_BODY_BYTES = 4 * 1024;
// Every answer on home and while cooking is spoken once.
const allowRequest = createRateLimiter(40);

export const SpeakRequestSchema = z.object({
  text: z.string().trim().min(1).max(600),
  cuisine: z.enum(CUISINES).nullish(),
  context: z.string().trim().max(600).optional(),
});

export async function handleSpeak(req, res) {
  const request = await readJsonRequest(req, res, {
    schema: SpeakRequestSchema,
    maxBytes: MAX_BODY_BYTES,
    allow: allowRequest,
    tooManyMessage: "Too many requests. Wait a minute and try again.",
  });
  if (!request) return;

  if (!speechConfigured()) {
    sendJson(res, 503, { error: "Speech isn't configured on this server" });
    return;
  }

  const started = performance.now();
  try {
    const persona = personaFor(request.cuisine, request.context);
    const { audio, voice } = await synthesize(request.text, persona);
    console.log(`speak: ${request.text.length} chars in ${Math.round(performance.now() - started)} ms, ${Math.round(audio.length / 1024)} KB, ${persona} (${voice} voice)`);
    res
      .writeHead(200, {
        "content-type": "audio/mpeg",
        "content-length": audio.length,
        "cache-control": "no-store",
        // "character" (the cook's own voice) or "fallback" (a plain voice, when that failed)
        "x-voice": voice,
        "x-persona": persona,
      })
      .end(audio);
  } catch (err) {
    console.error(`speak failed after ${Math.round(performance.now() - started)} ms:`, err.message);
    sendJson(res, 502, { error: "Couldn't read that aloud" });
  }
}
