import {useEffect, useState} from 'react';
import {timerOutline} from '@wearables-ui-toolkit/icons';
import {IconImage, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';
import {shownLabel, timeLeft, type Timer} from './timers';

// The timers, one line each: icon, label, time left counting down every second ("Time's up"
// once it ended). Its own component so only this row redraws each second, not the lists.
export function TimerDock({timers}: {timers: readonly Timer[]}) {
  const [now, setNow] = useState(() => Date.now());

  const running = timers.some(t => !t.done);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [running, timers]);

  if (!timers.length) return null;
  return (
    <div className="timers-dock" aria-label="Timers">
      {timers.map(timer => (
        <div key={timer.id} className="timer-line">
          <IconImage source={timerOutline} className="timer-icon" />
          {shownLabel(timer) && (
            <TextView as="span" textStyle={TextStyle.BODY2}>
              {shownLabel(timer)}
            </TextView>
          )}
          <TextView as="span" textStyle={TextStyle.BODY2_EMPHASIZED} className="timer-text">
            {timeLeft(timer, now)}
          </TextView>
        </div>
      ))}
    </div>
  );
}
