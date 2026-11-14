// Spoken answers: the answer's text read aloud as MP3, in the EU.
//
// The voice is a character: Gemini's speech model (gemini-3.8-flash-lite-tts) on the EU
// endpoint (aiplatform.eu.rep.googleapis.com, same service account as Gemini), with a
// prebuilt voice and a style ("an energetic, passionate British chef..."). It takes about
// 1.5-2 s for a 30-word answer. Gemini sends raw audio (16-bit PCM, 24 kHz), so the server
// encodes it to MP3: ~25-35 KB instead of ~0.3 MB.
//
// If Gemini fails or is slow, Google Cloud Text-to-Speech reads it with a plain British
// Chirp 3 HD voice (eu-texttospeech.googleapis.com, about 1 s; the project needs the Cloud
// Text-to-Speech API enabled). Both are configurable:
//   TTS_MODEL, TTS_VOICE, TTS_STYLE        the Gemini voice
//   TTS_FALLBACK_VOICE, TTS_FALLBACK_HOST  the plain voice

import { Mp3Encoder } from "@breezystack/lamejs";
import { GoogleAuth } from "google-auth-library";
import { LOCATION, loadCredentials } from "./gemini.js";

export const TTS_MODEL = process.env.TTS_MODEL ?? "gemini-3.8-flash-lite-tts";
export const TTS_VOICE = process.env.TTS_VOICE ?? "Algenib";
export const TTS_STYLE =
  process.env.TTS_STYLE ??
  "An energetic, passionate British chef, warm but a bit cheeky, with a deep bass voice and a British accent.";
export const TTS_FALLBACK_VOICE = process.env.TTS_FALLBACK_VOICE ?? "en-GB-Chirp3-HD-Charon";
const TTS_FALLBACK_HOST = process.env.TTS_FALLBACK_HOST ?? "eu-texttospeech.googleapis.com";

const GEMINI_TIMEOUT_MS = 6_000;
const FALLBACK_TIMEOUT_MS = 3_000;
const SAMPLE_RATE = 24_000; // Gemini's speech output: 16-bit mono PCM at 24 kHz
// 40, not lower: at 32 kbps lamejs resamples to 22.05 kHz, and its resampler turns speech
// into silence (a plain test tone survives it, so test with real speech). 40 keeps 24 kHz.
const MP3_KBPS = 40;

// The EU and US multi-regions have their own hosts; single regions use the regional one.
const AIPLATFORM_HOST =
  LOCATION === "eu" || LOCATION === "us" ? `aiplatform.${LOCATION}.rep.googleapis.com` : `${LOCATION}-aiplatform.googleapis.com`;

let auth; // GoogleAuth, null without credentials, undefined before first use
let lastSpeech = null; // { ok, voice, ms, at, chars, error? }

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
 * MP3 audio of `text` read aloud: the Gemini chef voice, or the plain voice if that fails.
 * Returns { audio: Buffer, voice: "gemini" | "fallback" }. Throws when both fail.
 */
export async function synthesize(text) {
  const started = performance.now();
  const at = new Date().toISOString();
  const done = (entry) => {
    lastSpeech = { ...entry, ms: Math.round(performance.now() - started), at, chars: text.length };
  };
  let geminiError;
  try {
    const audio = await geminiSpeech(text);
    done({ ok: true, voice: "gemini" });
    return { audio, voice: "gemini" };
  } catch (err) {
    geminiError = reasonOf(err);
    console.error("speech: Gemini voice failed, using the plain voice:", geminiError);
  }
  try {
    const audio = await plainSpeech(text);
    done({ ok: true, voice: "fallback", error: `gemini: ${geminiError}`.slice(0, 300) });
    return { audio, voice: "fallback" };
  } catch (err) {
    const reason = `gemini: ${geminiError} | fallback: ${reasonOf(err)}`;
    done({ ok: false, voice: null, error: reason.slice(0, 300) });
    throw new Error(reason);
  }
}

// Streams the audio (server-sent events of raw PCM chunks) and collects it: measured ~0.4 s
// faster in total than one generateContent call (1.5 s vs 1.9 s for a 30-word answer).
async function geminiSpeech(text) {
  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();
  const { project_id } = loadCredentials();
  const url = `https://${AIPLATFORM_HOST}/v1/projects/${project_id}/locations/${LOCATION}/publishers/google/models/${TTS_MODEL}:streamGenerateContent?alt=sse`;
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      // The style goes beside the text, not in it: the model reads the text word for word.
      contents: [{ role: "user", parts: [{ text, speechMetadata: { style: TTS_STYLE } }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { voice: TTS_VOICE } } },
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

async function plainSpeech(text) {
  const client = await getAuth().getClient();
  const { project_id } = loadCredentials();
  const response = await client.request({
    url: `https://${TTS_FALLBACK_HOST}/v1/text:synthesize`,
    method: "POST",
    headers: { "x-goog-user-project": project_id },
    data: {
      input: { text },
      voice: { languageCode: TTS_FALLBACK_VOICE.split("-").slice(0, 2).join("-"), name: TTS_FALLBACK_VOICE },
      audioConfig: { audioEncoding: "MP3" },
    },
    timeout: FALLBACK_TIMEOUT_MS,
  });
  const audio = Buffer.from(response.data?.audioContent ?? "", "base64");
  if (!audio.length) throw new Error("no audio in the Text-to-Speech response");
  return audio;
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
    voice: TTS_VOICE,
    style: TTS_STYLE,
    fallback_voice: TTS_FALLBACK_VOICE,
    last: lastSpeech,
  };
}
