// Reads answers aloud through the glasses speaker. The screens show an answer when its voice
// starts (speak() resolves then), so text and voice arrive together; speech failing is never
// fatal, the text shows anyway. The cook can turn voice off on home (RecipesContext sets
// it); then speak() does nothing.
//
// The voice comes from the server (POST /api/speak: a British chef voice from Gemini as MP3,
// in the EU), played with an <audio> element. When that fails or takes too long, the device's own
// voice (speechSynthesis, which plays on Ray-Ban Display) reads it instead. A newer speak()
// or stopSpeaking() cancels whatever is fetching or playing.

// The chef voice takes ~1.5-2 s; the server falls back to a plain voice itself when Gemini is
// slow, so this only catches a server that doesn't answer at all.
const SERVER_TIMEOUT_MS = 9_000;
// How long an answer's text waits for its voice before it shows anyway.
const WAIT_FOR_VOICE_MS = 4_000;
// Short fixed phrases ("Recipe updated.") are kept, so they play at once next time.
const CACHE_MAX_CHARS = 40;
const CACHE_SIZE = 10;
// The recipe title goes along for older recipes without a cuisine (the server allows 600).
const CONTEXT_MAX_CHARS = 600;

let voiceOn = true;
// Off for the rest of the visit once the server says it has no voice (503).
let serverVoice = true;
let current = 0; // id of the latest speak(); older ones stop when it changes
let fetching: AbortController | null = null;
let playing: {audio: HTMLAudioElement; url: string} | null = null;
const cache = new Map<string, Blob>();
const preloading = new Map<string, Promise<Blob>>();

export function setVoiceOn(on: boolean): void {
  voiceOn = on;
  if (!on) stopSpeaking();
}

/**
 * Whose voice: a recipe's cuisine picks its cook (Pankaj for 'indian', …); `context` (the
 * recipe title) covers older recipes without a cuisine. Nothing, as on home: the British chef.
 */
export interface Voice {
  cuisine?: string | null;
  context?: string;
}

/** The voice for answers about this recipe: its cuisine's cook. */
export function voiceOf(recipe: {cuisine?: string | null; title: string}): Voice {
  return {cuisine: recipe.cuisine ?? null, context: recipe.title};
}

/**
 * Reads `text` aloud. Resolves once the voice starts, so the caller can show the answer at
 * that moment and it doesn't sit on screen waiting for its voice: when the audio starts
 * playing, when the device's voice takes over, at once when voice is off, or after
 * WAIT_FOR_VOICE_MS at the latest (the audio then still plays when it arrives). Never rejects.
 */
export function speak(text: string, voice: Voice = {}): Promise<void> {
  if (!voiceOn || !text.trim()) return Promise.resolve();
  stopSpeaking();
  const id = current;
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, WAIT_FOR_VOICE_MS);
    const started = () => {
      clearTimeout(timer);
      resolve();
    };
    if (!serverVoice || typeof Audio === 'undefined') {
      speakLocally(text);
      started();
      return;
    }
    serverAudio(text, voice)
      .then(blob => {
        if (id !== current) return started();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        playing = {audio, url};
        audio.addEventListener('ended', () => {
          if (playing?.audio === audio) stopPlaying();
        });
        return audio.play().then(started, (err: unknown) => {
          // Autoplay blocked or the format won't play: use the device's voice.
          if (id !== current) return started();
          stopPlaying();
          throw err;
        });
      })
      .catch(() => {
        if (id === current) speakLocally(text);
        started();
      });
  });
}

/**
 * Fetches the audio for `text` now, to play later with speak(text, voice) at once: the
 * chef's handover is made while the recipe is still being found. Not cancelled by
 * stopSpeaking().
 */
export function prefetchSpeech(text: string, voice: Voice = {}): void {
  if (!voiceOn || !serverVoice || !text.trim()) return;
  const key = keyOf(text, voice);
  if (cache.has(key) || preloading.has(key)) return;
  const loading = requestAudio(text, voice, AbortSignal.timeout(SERVER_TIMEOUT_MS))
    .then(blob => {
      remember(key, blob);
      return blob;
    })
    .finally(() => preloading.delete(key));
  loading.catch(() => {}); // speak() falls back on its own if it was waiting for this
  preloading.set(key, loading);
}

export function stopSpeaking(): void {
  current += 1;
  fetching?.abort();
  fetching = null;
  stopPlaying();
  if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel();
}

// The same words sound different in another voice.
function keyOf(text: string, voice: Voice): string {
  return `${voice.cuisine ?? ''}\n${voice.context ?? ''}\n${text}`;
}

function remember(key: string, blob: Blob): void {
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  cache.set(key, blob);
}

async function serverAudio(text: string, voice: Voice): Promise<Blob> {
  const key = keyOf(text, voice);
  const ready = cache.get(key) ?? preloading.get(key);
  if (ready) return ready;
  const controller = new AbortController();
  fetching = controller;
  const blob = await requestAudio(text, voice, AbortSignal.any([controller.signal, AbortSignal.timeout(SERVER_TIMEOUT_MS)]));
  if (fetching === controller) fetching = null;
  if (text.length <= CACHE_MAX_CHARS) remember(key, blob);
  return blob;
}

async function requestAudio(text: string, voice: Voice, signal: AbortSignal): Promise<Blob> {
  const res = await fetch('/api/speak', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    // The server picks the voice: the cuisine's cook, else the chef.
    body: JSON.stringify({text, cuisine: voice.cuisine ?? undefined, context: voice.context?.slice(0, CONTEXT_MAX_CHARS)}),
    signal,
  });
  if (res.status === 503) serverVoice = false;
  if (!res.ok) throw new Error(`/api/speak answered ${res.status}`);
  return res.blob();
}

function stopPlaying(): void {
  if (!playing) return;
  playing.audio.pause();
  URL.revokeObjectURL(playing.url);
  playing = null;
}

function speakLocally(text: string): void {
  if (typeof window.speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-GB';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
