// Kitchen timers on the cooking screen, started and stopped by voice ("set a timer for 10
// minutes", "time the pasta", "stop the timer"): /api/ask returns the timer, the app runs it.
// Free of React and the DOM, like cookingState.ts. Each timer is one line on screen, its
// label and the time left counting down every second, "Pasta 8:42" (the cook asked for a
// live countdown; native re-sends the whole screen per update, so it may tick less often
// there). That line is the whole UI: starting a timer shows it (the voice confirms), and when
// it ends it reads "Time's up" for TIMER_DONE_VISIBLE_MS, with a ping and the voice, then goes.

export interface Timer {
  id: string;
  /** One or two words: what it times ("Pasta"). */
  label: string;
  /** When it ends, in ms since the epoch. */
  endsAt: number;
  /** It ended: shows "Time's up" until TIMER_DONE_VISIBLE_MS after endsAt. */
  done?: boolean;
}

/** What /api/ask asks for: start one, or cancel by label ("" = all). */
export type TimerCommand = {action: 'start'; seconds: number; label: string} | {action: 'cancel'; label: string};

/** At most this many run at once; a new one replaces the oldest. */
export const MAX_TIMERS = 3;

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The timers after a voice command. A new timer with a running timer's label restarts it. */
export function applyTimerCommand(timers: readonly Timer[], command: TimerCommand, now: number): Timer[] {
  if (command.action === 'cancel') {
    if (!command.label) return [];
    const kept = timers.filter(t => !sameLabel(t.label, command.label));
    // A label that matches nothing ("stop the timer" with one running): the one ending first.
    if (kept.length === timers.length && timers.length) {
      const first = [...timers].sort((a, b) => a.endsAt - b.endsAt)[0];
      return timers.filter(t => t !== first);
    }
    return kept;
  }
  const endsAt = now + command.seconds * 1000;
  const timer: Timer = {id: `${command.label}-${endsAt}`, label: command.label, endsAt};
  const others = timers.filter(t => !sameLabel(t.label, command.label));
  return [...others, timer].slice(-MAX_TIMERS);
}

/** The time left, "8:42" (h:mm:ss past an hour), or "Time's up" once it ended. */
export function timeLeft(timer: Timer, now: number): string {
  if (timer.done) return "Time's up";
  const total = Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The timers once `id` ended: it stays, showing "Time's up". */
export function markDone(timers: readonly Timer[], id: string): Timer[] {
  return timers.map(t => (t.id === id ? {...t, done: true} : t));
}

/** Said after the ping when a timer ends. */
export function timerDoneSpeech(timer: Timer): string {
  return timer.label === 'Timer' ? "Time's up! Your timer is done." : `Time's up! ${timer.label} timer is done.`;
}

/** How long an ended timer shows "Time's up" before it goes. */
export const TIMER_DONE_VISIBLE_MS = 3_000;
