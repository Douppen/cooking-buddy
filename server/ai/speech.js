// Spoken answers: the answer's text read aloud as MP3, in the EU.
//
// The voice is a character: Gemini's speech model (gemini-3.8-flash-lite-tts) on the EU
// endpoint (aiplatform.eu.rep.googleapis.com, same service account as Gemini), with a
// prebuilt voice and a style ("an energetic, passionate British chef..."). It takes about
// 1.5-2 s for a 30-word answer. Gemini sends raw audio (16-bit PCM, 24 kHz), so the server
// encodes it to MP3: ~25-35 KB instead of ~0.3 MB.
//
// Who speaks: the British chef on home, and per recipe its cuisine's cook (ai/personas.js:
// Pankaj, Uncle Wei, Giuseppe, Abuela Rosa, Chef Jacques, Kenji, Auntie Mali,
// Babushka Olga, Bubba).
//
// If Gemini fails or is slow, Google Cloud Text-to-Speech reads it with the persona's plain
// Chirp 3 HD voice (eu-texttospeech.googleapis.com, about 1 s; the project needs the Cloud
// Text-to-Speech API enabled). Configurable: TTS_MODEL, TTS_FALLBACK_HOST; the chef's
// TTS_VOICE, TTS_STYLE, TTS_FALLBACK_VOICE.

import { Mp3Encoder } from "@breezystack/lamejs";
import { GoogleAuth } from "google-auth-library";
import { LOCATION, MODEL, getClient, loadCredentials } from "./gemini.js";
import { PERSONAS } from "./personas.js";

export const TTS_MODEL = process.env.TTS_MODEL ?? "gemini-3.8-flash-lite-tts";

const TTS_FALLBACK_HOST = process.env.TTS_FALLBACK_HOST ?? "eu-texttospeech.googleapis.com";

const GEMINI_TIMEOUT_MS = 6_000;
const FALLBACK_TIMEOUT_MS = 3_000;
const CHIRP_TIMEOUT_MS = 4_000;
const REWRITE_TIMEOUT_MS = 3_000;
const SAMPLE_RATE = 24_000; // Gemini's speech output: 16-bit mono PCM at 24 kHz
// 40, not lower: at 32 kbps lamejs resamples to 22.05 kHz, and its resampler turns speech
// into silence (a plain test tone survives it, so test with real speech). 40 keeps 24 kHz.
const MP3_KBPS = 40;

// The EU and US multi-regions have their own hosts; single regions use the regional one.
const AIPLATFORM_HOST =
  LOCATION === "eu" || LOCATION === "us" ? `aiplatform.${LOCATION}.rep.googleapis.com` : `${LOCATION}-aiplatform.googleapis.com`;

let auth; // GoogleAuth, null without credentials, undefined before first use
let lastSpeech = null; // { ok, persona, voice, ms, at, chars, error? }

function getAuth() {
  if (auth !== undefined) return auth;
  auth = null;
  try {
    const credentials = loadCredentials();
    if (credentials) {
      auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    }
  } catch (err) {
    console.error("speech: could not load Google credentials:", err.message);
  }
  return auth;
}

export function speechConfigured() {
  return getAuth() !== null;
}

/**
 * MP3 audio of `text` read aloud by `persona` (a key of PERSONAS): its character voice, or
 * its plain voice if that fails. The character voice may first respell the text the way the
 * cook pronounces it (cook.rewrite: katakana for Kenji), then reads it with Gemini (voice,
 * style, languageCode) or a native-language Chirp 3 HD voice (cook.chirp). The plain voice
 * reads the original text. Returns { audio: Buffer, voice: "character" | "fallback" }.
 * Throws when both fail.
 */
export async function synthesize(text, persona = "chef") {
  const cook = PERSONAS[persona] ?? PERSONAS.chef;
  const started = performance.now();
  const at = new Date().toISOString();
  const done = (entry) => {
    lastSpeech = { ...entry, persona, ms: Math.round(performance.now() - started), at, chars: text.length };
  };
  let characterError;
  try {
    const said = cook.rewrite ? await rewriteForAccent(text, cook.rewrite) : text;
    const audio = cook.chirp ? await chirpSpeech(said, cook.chirp, CHIRP_TIMEOUT_MS) : await geminiSpeech(said, cook);
    done({ ok: true, voice: "character" });
    return { audio, voice: "character" };
  } catch (err) {
    characterError = reasonOf(err);
    console.error(`speech: ${persona}'s voice failed, using the plain voice:`, characterError);
  }
  try {
    const audio = await chirpSpeech(text, { voice: cook.fallback }, FALLBACK_TIMEOUT_MS);
    done({ ok: true, voice: "fallback", error: `character: ${characterError}`.slice(0, 300) });
    return { audio, voice: "fallback" };
  } catch (err) {
    const reason = `character: ${characterError} | fallback: ${reasonOf(err)}`;
    done({ ok: false, voice: null, error: reason.slice(0, 300) });
    throw new Error(reason);
  }
}

// Streams the audio (server-sent events of raw PCM chunks) and collects it: measured ~0.4 s
// faster in total than one generateContent call (1.5 s vs 1.9 s for a 30-word answer).
async function geminiSpeech(text, { voice, style, languageCode }) {
  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();
  const { project_id } = loadCredentials();
  const url = `https://${AIPLATFORM_HOST}/v1/projects/${project_id}/locations/${LOCATION}/publishers/google/models/${TTS_MODEL}:streamGenerateContent?alt=sse`;
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      // The style goes beside the text, not in it: the model reads the text word for word.
      contents: [{ role: "user", parts: [{ text, speechMetadata: { style } }] }],
      // languageCode ("fr-FR", "ru-RU") makes the accent: a style alone gave Chef Jacques a
      // mild accent; with fr-FR an AI rater heard "unmistakably French".
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { voice }, ...(languageCode ? { languageCode } : {}) },
      },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body.slice(0, 300);
    try {
      message = JSON.parse(body)?.[0]?.error?.message ?? JSON.parse(body)?.error?.message ?? message;
    } catch {}
    throw new Error(`${response.status}: ${message}`);
  }
  const chunks = [];
  let mimeType;
  let pending = "";
  const decoder = new TextDecoder();
  const readLine = (line) => {
    if (!line.startsWith("data:")) return;
    const inline = JSON.parse(line.slice(5)).candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!inline?.data) return;
    mimeType ??= inline.mimeType;
    chunks.push(Buffer.from(inline.data, "base64"));
  };
  for await (const part of response.body) {
    pending += decoder.decode(part, { stream: true });
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      readLine(pending.slice(0, end).trim());
      pending = pending.slice(end + 1);
    }
  }
  readLine(pending.trim());
  if (!chunks.length) throw new Error("no audio in Gemini's response");
  return toMp3(pcmOf(Buffer.concat(chunks), mimeType));
}

// A Chirp 3 HD voice from Cloud Text-to-Speech, MP3 straight away: the cooks' plain
// fallback voices, and the native-language voices some cooks speak with (a Japanese voice
// reading katakana English sounds Japanese; reading English, it sounds British).
async function chirpSpeech(text, { voice, languageCode, speakingRate }, timeout) {
  const client = await getAuth().getClient();
  const { project_id } = loadCredentials();
  const response = await client.request({
    url: `https://${TTS_FALLBACK_HOST}/v1/text:synthesize`,
    method: "POST",
    headers: { "x-goog-user-project": project_id },
    data: {
      input: { text },
      voice: { languageCode: languageCode ?? voice.split("-").slice(0, 2).join("-"), name: voice },
      audioConfig: { audioEncoding: "MP3", ...(speakingRate ? { speakingRate } : {}) },
    },
    timeout,
  });
  const audio = Buffer.from(response.data?.audioContent ?? "", "base64");
  if (!audio.length) throw new Error("no audio in the Text-to-Speech response");
  return audio;
}

// The text the way the cook pronounces it (katakana for Kenji, a respelling for Uncle Wei):
// one fast Gemini call in the EU, ~0.8 s. Describing an accent in the style wasn't enough for
// these voices: an AI rater heard American or British English every time.
async function rewriteForAccent(text, instruction) {
  const ai = getClient();
  if (!ai) throw new Error("no Gemini client for the respelling");
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: text,
    config: {
      systemInstruction: instruction,
      thinkingConfig: { thinkingLevel: "LOW" },
      maxOutputTokens: 1024,
      abortSignal: AbortSignal.timeout(REWRITE_TIMEOUT_MS),
    },
  });
  const said = response.text?.trim();
  if (!said) throw new Error("empty respelling");
  return said;
}

// Gemini answers with raw PCM ("audio/L16;codec=pcm;rate=24000") or, for some requests, a
// WAV file; either way, the 16-bit samples.
function pcmOf(bytes, mimeType = "") {
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF") {
    const data = bytes.indexOf("data", 12, "ascii");
    if (data < 0) throw new Error("WAV without a data chunk");
    return bytes.subarray(data + 8);
  }
  const rate = /rate=(\d+)/.exec(mimeType)?.[1];
  if (rate && Number(rate) !== SAMPLE_RATE) throw new Error(`unexpected sample rate ${rate}`);
  return bytes;
}

function toMp3(pcm) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const encoder = new Mp3Encoder(1, SAMPLE_RATE, MP3_KBPS);
  const chunks = [];
  for (let i = 0; i < samples.length; i += 1152 * 64) {
    chunks.push(encoder.encodeBuffer(samples.subarray(i, i + 1152 * 64)));
  }
  chunks.push(encoder.flush());
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.length)));
}

// Google's error body says why (API not enabled, no permission, unknown voice).
function reasonOf(err) {
  return err?.response?.data?.error?.message ?? err?.message ?? String(err);
}

// The first call has to fetch an access token; fetch it at startup (free).
export function warmUpSpeech() {
  const a = getAuth();
  if (!a) return;
  a.getAccessToken().catch((err) => console.error("speech: token warm-up failed:", err?.message ?? err));
}

// For GET /api/status: which voice is set up, and how the last spoken answer went.
export function speechStatus() {
  return {
    configured: speechConfigured(),
    model: TTS_MODEL,
    personas: PERSONAS,
    last: lastSpeech,
  };
}
