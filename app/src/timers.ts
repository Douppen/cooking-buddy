// Kitchen timers on the cooking screen, started and stopped by voice ("set a timer for 10
// minutes", "time the pasta", "stop the timer"): /api/ask returns the timer, the app runs it.
// Free of React and the DOM, like cookingState.ts. The screen shows each timer as one line
// counting down every second, "Pasta · 8:42 · done 15:42" (the cook asked for a live
// countdown; native re-sends the whole screen per update, so it may tick less often there).
// When one ends, the app says so.

export interface Timer {
  id: string;
  /** One or two words: what it times ("Pasta"). */
  label: string;
  /** When it ends, in ms since the epoch. */
  endsAt: number;
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

/** "Pasta · 8:42 · done 15:42": time left (m:ss, or h:mm:ss) and the clock time it ends. */
export function timerLine(timer: Timer, now: number): string {
  const total = Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  const left = h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  const end = new Date(timer.endsAt);
  const clock = `${end.getHours()}:${String(end.getMinutes()).padStart(2, '0')}`;
  return `${timer.label} · ${left} · done ${clock}`;
}

/** Said and shown when a timer ends. */
export function timerDoneText(timer: Timer): string {
  return timer.label === 'Timer' ? 'Your timer is done.' : `${timer.label} timer is done.`;
}
