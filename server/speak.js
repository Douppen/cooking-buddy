// POST /api/speak: an answer read aloud, for the glasses' speaker.
//
// Request (JSON):  { text: "Try egg fried rice or a shakshuka." }   (up to 600 characters)
// Response:        200 audio/mpeg (MP3); header x-voice: "gemini" (the chef voice) or
//                  "fallback" (the plain voice, used when Gemini failed)
//                  503 { error } when speech isn't configured, 502 { error } when Google fails
//
// The app shows the answer first (from /api/home or /api/ask), then fetches this and plays it;
// if it fails, the app falls back to the device's own voice. The native app plays the same MP3.

import { z } from "zod";
import { speechConfigured, synthesize } from "./ai/speech.js";
import { createRateLimiter, readJsonRequest, sendJson } from "./http.js";

const MAX_BODY_BYTES = 4 * 1024;
// Every answer on home and while cooking is spoken once.
const allowRequest = createRateLimiter(40);

export const SpeakRequestSchema = z.object({
  text: z.string().trim().min(1).max(600),
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
    const { audio, voice } = await synthesize(request.text);
    console.log(`speak: ${request.text.length} chars in ${Math.round(performance.now() - started)} ms, ${Math.round(audio.length / 1024)} KB, ${voice} voice`);
    res
      .writeHead(200, {
        "content-type": "audio/mpeg",
        "content-length": audio.length,
        "cache-control": "no-store",
        // "gemini" (the chef) or "fallback" (the plain voice, when Gemini failed)
        "x-voice": voice,
      })
      .end(audio);
  } catch (err) {
    console.error(`speak failed after ${Math.round(performance.now() - started)} ms:`, err.message);
    sendJson(res, 502, { error: "Couldn't read that aloud" });
  }
}
