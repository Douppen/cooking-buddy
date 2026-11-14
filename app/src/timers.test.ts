// `npm test` in app/ (node's test runner, see units.test.ts).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyTimerCommand, timerDoneSpeech, timerDoneText, timerLine, type Timer} from './timers.ts';

const at = (h: number, m: number) => new Date(2026, 10, 14, h, m).getTime();

test('voice commands start, restart and stop timers', () => {
  const now = at(15, 34);
  let timers = applyTimerCommand([], {action: 'start', seconds: 600, label: 'Pasta'}, now);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].endsAt, at(15, 44));
  timers = applyTimerCommand(timers, {action: 'start', seconds: 1200, label: 'Sauce'}, now);
  // Same label again: restarts it, no second pasta timer.
  timers = applyTimerCommand(timers, {action: 'start', seconds: 480, label: 'pasta'}, now);
  assert.deepEqual(timers.map(t => t.label), ['Sauce', 'pasta']);
  assert.deepEqual(applyTimerCommand(timers, {action: 'cancel', label: 'Sauce'}, now).map(t => t.label), ['pasta']);
  // No match: the one ending first goes.
  assert.deepEqual(applyTimerCommand(timers, {action: 'cancel', label: 'Timer'}, now).map(t => t.label), ['Sauce']);
  assert.deepEqual(applyTimerCommand(timers, {action: 'cancel', label: ''}, now), []);
});

test('at most 3 timers: a new one replaces the oldest', () => {
  let timers: Timer[] = [];
  for (const label of ['A', 'B', 'C', 'D']) timers = applyTimerCommand(timers, {action: 'start', seconds: 60, label}, 0);
  assert.deepEqual(timers.map(t => t.label), ['B', 'C', 'D']);
});

test('a timer counts down to the second and shows when it ends', () => {
  const timer: Timer = {id: 'x', label: 'Pasta', endsAt: at(15, 42)};
  assert.equal(timerLine(timer, at(15, 34)), 'Pasta · 8:00 · done 15:42');
  assert.equal(timerLine(timer, at(15, 34) + 1_000), 'Pasta · 7:59 · done 15:42');
  assert.equal(timerLine(timer, at(15, 41) + 30_500), 'Pasta · 0:30 · done 15:42'); // rounds up
  assert.equal(timerLine(timer, at(15, 43)), 'Pasta · 0:00 · done 15:42');
  assert.equal(timerLine({id: 'y', label: 'Stew', endsAt: at(17, 5)}, at(15, 0)), 'Stew · 2:05:00 · done 17:05');
  assert.equal(timerDoneText(timer), 'Pasta timer is done.');
  assert.equal(timerDoneText({...timer, label: 'Timer'}), 'Your timer is done.');
  assert.equal(timerDoneSpeech(timer), "Time's up! Pasta timer is done.");
});
