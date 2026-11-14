// A short two-tone ping when a timer ends, made with Web Audio: no sound file to load. It
// plays through the glasses' speakers like speech does. Browsers only let a page make sound
// after the user did something, so unlockChime() runs on the pinch that asks for a timer.
// The ping plays even with Voice off: a timer should be heard. Native: a short system sound.

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

/** Call from a user action (a pinch), so the ping may play later. */
export function unlockChime(): void {
  const ctx = audio();
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
}

/** Two soft beeps, high then higher, about half a second in all. */
export function playChime(): void {
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  const start = ctx.currentTime + 0.02;
  [
    {freq: 880, at: 0},
    {freq: 1320, at: 0.18},
  ].forEach(({freq, at}) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Quick fade in and out, so it pings instead of clicking.
    gain.gain.setValueAtTime(0, start + at);
    gain.gain.linearRampToValueAtTime(0.25, start + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + at + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + at);
    osc.stop(start + at + 0.32);
  });
}

/** How long the ping takes, so speech starts after it. */
export const CHIME_MS = 550;
