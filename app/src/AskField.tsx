import {useRef, type KeyboardEvent} from 'react';
import {InputTextView} from '@wearables-ui-toolkit/mrbd';

// The ask field on home and while cooking, with its send button (➤) to the right. Enter in
// the field sends, and so does pinching or clicking ➤. Focus never moves to ➤ by itself:
// the cook stays in the field while typing (an automatic jump after a pause was removed on
// 2026-11-15).
//   swipe left on ➤   back to the field
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
      {/* While busy, the field holds nothing but "Loading…": not the words just sent, not its hint. */}
      <InputTextView
        text={busy ? '' : text}
        hint={busy ? LOADING_HINT : hint}
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
