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

let voiceOn = true;
// Off for the rest of the visit once the server says it has no voice (503).
let serverVoice = true;
let current = 0; // id of the latest speak(); older ones stop when it changes
let fetching: AbortController | null = null;
let playing: {audio: HTMLAudioElement; url: string} | null = null;
const cache = new Map<string, Blob>();

export function setVoiceOn(on: boolean): void {
  voiceOn = on;
  if (!on) stopSpeaking();
}

/**
 * Reads `text` aloud. Resolves once the voice starts, so the caller can show the answer at
 * that moment and it doesn't sit on screen waiting for its voice: when the audio starts
 * playing, when the device's voice takes over, at once when voice is off, or after
 * WAIT_FOR_VOICE_MS at the latest (the audio then still plays when it arrives). Never rejects.
 */
export function speak(text: string): Promise<void> {
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
    serverAudio(text)
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

export function stopSpeaking(): void {
  current += 1;
  fetching?.abort();
  fetching = null;
  stopPlaying();
  if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel();
}

async function serverAudio(text: string): Promise<Blob> {
  const cached = cache.get(text);
  if (cached) return cached;
  const controller = new AbortController();
  fetching = controller;
  const res = await fetch('/api/speak', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({text}),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(SERVER_TIMEOUT_MS)]),
  });
  if (res.status === 503) serverVoice = false;
  if (!res.ok) throw new Error(`/api/speak answered ${res.status}`);
  const blob = await res.blob();
  if (fetching === controller) fetching = null;
  if (text.length <= CACHE_MAX_CHARS) {
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    cache.set(text, blob);
  }
  return blob;
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
