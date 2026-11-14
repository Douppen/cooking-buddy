import {useEffect, useState} from 'react';
import {timerOutline} from '@wearables-ui-toolkit/icons';
import {IconImage, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';
import {timerLine, type Timer} from './timers';

// The running timers, one line each, counting down every second. Its own component so only
// this row redraws each second, not the recipe lists.
export function TimerDock({timers}: {timers: readonly Timer[]}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timers.length) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [timers]);

  if (!timers.length) return null;
  return (
    <div className="timers-dock" aria-label="Timers">
      {timers.map(timer => (
        <div key={timer.id} className="timer-line">
          <IconImage source={timerOutline} className="timer-icon" />
          <TextView as="span" textStyle={TextStyle.BODY2_EMPHASIZED} className="timer-text">
            {timerLine(timer, now)}
          </TextView>
        </div>
      ))}
    </div>
  );
}
