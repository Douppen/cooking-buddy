import {useEffect, useRef, type KeyboardEvent} from 'react';
import {InputTextView} from '@wearables-ui-toolkit/mrbd';

// The ask field on home and while cooking, with its send button (➤) to the right. On the
// glasses a pinch on the field opens the system composer (dictation, handwriting, keyboard),
// which hands back the whole text with no Enter, so sending needs its own target:
//   pinch the field   say it (again: the composer opens with the text)
//   (text arrives)    focus moves to ➤ by itself
//   pinch ➤           send
//   swipe left on ➤   back to the field, to say it again
// On a laptop, Enter in the field still sends, and focus waits for a pause in typing.
// Native: a text row that starts dictation, and a send button that takes focus once the
// transcript is in.

/** Shown above the field while there's text to send. */
export const SEND_HINT = 'Pinch ➤ to send, or swipe left to say it again.';

// The composer hands over the whole text at once; typing comes letter by letter.
const FOCUS_SEND_AFTER_MS = 900;
const SEND_LABEL = 'Send';

export function AskField({
  text,
  onTextChange,
  onSend,
  hint,
  busy,
  loadingLabel,
  ariaLabel,
  maxLength,
}: {
  text: string;
  onTextChange: (text: string) => void;
  onSend: (text: string) => void;
  hint: string;
  busy: boolean;
  loadingLabel: string;
  ariaLabel: string;
  maxLength: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  // The toolkit's ➤ is a focusable element labelled with actionLabel, not a <button>.
  const sendButton = () => box.current?.querySelector<HTMLElement>(`[aria-label="${SEND_LABEL}"]`) ?? null;
  const field = () => box.current?.querySelector<HTMLTextAreaElement>('textarea') ?? null;

  // New text while the field has focus: move to ➤, so the next pinch sends.
  useEffect(() => {
    if (!text.trim() || busy) return;
    const input = field();
    if (!input || document.activeElement !== input) return;
    const timer = setTimeout(() => sendButton()?.focus(), FOCUS_SEND_AFTER_MS);
    return () => clearTimeout(timer);
  }, [text, busy]);

  // Swipe left on ➤: back to the field. Stopped here, so the cooking screen doesn't also
  // take it as "previous view".
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' || event.target !== sendButton()) return;
    event.preventDefault();
    event.stopPropagation();
    field()?.focus();
  };

  return (
    <div ref={box} onKeyDown={onKeyDown}>
      <InputTextView
        text={text}
        hint={hint}
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
