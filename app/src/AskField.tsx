import {useEffect, useRef, useState, type KeyboardEvent} from 'react';
import {microphoneFilled, microphoneOutline} from '@wearables-ui-toolkit/icons';
import {Button, InputTextView} from '@wearables-ui-toolkit/mrbd';
import {canListen, listen} from './listen';

// The ask field on home and while cooking, with its send button (➤) to the right. Enter in
// the field sends, and so does pinching or clicking ➤. Focus never moves to ➤ by itself:
// the cook stays in the field while typing (an automatic jump after a pause was removed on
// 2026-11-15).
//   swipe left on ➤   back to the field
// On the website (a laptop or phone browser, not the glasses) a 🎤 button sits left of the
// field: tap it and speak, the words fill the field live, then ➤ has focus to send
// (listen.ts). On the glasses it never shows: their dictation does this.
// Native: a text row that starts dictation, and a send button next to it.

/** Shown above the field while there's text to send. */
export const SEND_HINT = 'Press Enter or ➤ to send.';

const SEND_LABEL = 'Send';

/** What the field says while the answer or recipe comes. */
const LOADING_HINT = 'Loading…';

export function AskField({
  text,
  onTextChange,
  onSend,
  hint,
  shortHint,
  busy,
  loadingLabel,
  ariaLabel,
  maxLength,
}: {
  text: string;
  onTextChange: (text: string) => void;
  onSend: (text: string) => void;
  hint: string;
  /** For the narrower field next to the website's mic, so it stays on one line. */
  shortHint?: string;
  busy: boolean;
  loadingLabel: string;
  ariaLabel: string;
  maxLength: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [micShown] = useState(canListen);
  const [listening, setListening] = useState(false);
  const stopListening = useRef<(() => void) | null>(null);
  useEffect(() => () => stopListening.current?.(), []);
  // The toolkit's ➤ is a focusable element labelled with actionLabel, not a <button>.
  const sendButton = () => box.current?.querySelector<HTMLElement>(`[aria-label="${SEND_LABEL}"]`) ?? null;
  const field = () => box.current?.querySelector<HTMLTextAreaElement>('textarea') ?? null;

  // Swipe left on ➤: back to the field. Stopped here, so the cooking screen doesn't also
  // take it as "previous view".
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' || event.target !== sendButton()) return;
    event.preventDefault();
    event.stopPropagation();
    field()?.focus();
  };

  // The mic: tap to speak, tap again to stop early. The field fills in as words come; then ➤
  // has focus, so one more tap sends.
  const toggleMic = () => {
    if (listening) {
      stopListening.current?.();
      return;
    }
    setListening(true);
    stopListening.current = listen(onTextChange, heard => {
      stopListening.current = null;
      setListening(false);
      if (heard) sendButton()?.focus();
    });
  };

  const shownHint = busy ? LOADING_HINT : listening ? 'Listening…' : micShown ? (shortHint ?? hint) : hint;

  return (
    <div ref={box} onKeyDown={onKeyDown} className="ask-field">
      {micShown && (
        <Button
          icon={listening ? microphoneFilled : microphoneOutline}
          showIconActiveIndicator={listening}
          aria-label={listening ? 'Stop listening' : 'Speak'}
          aria-pressed={listening}
          onClick={toggleMic}
        />
      )}
      {/* While busy, the field holds nothing but "Loading…": not the words just sent, not its hint. */}
      <InputTextView
        text={busy ? '' : text}
        hint={shownHint}
        onTextChange={onTextChange}
        onSend={onSend}
        showActionButton
        actionLabel={SEND_LABEL}
        showLoader={busy}
        loadingLabel={loadingLabel}
        inputProps={{'aria-label': ariaLabel, maxLength}}
      />
    </div>
  );
}
