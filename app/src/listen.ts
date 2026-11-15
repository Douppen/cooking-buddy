// Speech to text for the website demo (a laptop or phone browser): the browser's own speech
// recognition (Web Speech API; Chrome sends the audio to Google to recognise). Not on the
// glasses: web apps there get no microphone, and the glasses' own dictation (pinch the field)
// does this instead, so canListen() is false there and the mic button never shows. Native:
// the phone's speech recognition.

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: {results: ArrayLike<ArrayLike<{transcript: string}> & {isFinal: boolean}>}) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: {error: string}) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor};
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// The glasses' browser, as the UI Toolkit recognises it ("Greatwhite" in an Android web view).
function onGlasses(): boolean {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return ua.includes('Greatwhite') || ua.includes('; wv)');
}

/** Whether this browser can turn speech into text here (never on the glasses). */
export function canListen(): boolean {
  return recognitionCtor() !== null && !onGlasses();
}

/**
 * Listens for one sentence. `onText` gets the words as they're recognised (so the field
 * fills in live), `onDone` the final text ('' when nothing was heard or it failed). Returns
 * a function that stops listening early (what was heard so far still counts).
 */
export function listen(onText: (text: string) => void, onDone: (text: string) => void): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    onDone('');
    return () => {};
  }
  const recognition = new Ctor();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;
  let heard = '';
  recognition.onresult = event => {
    heard = Array.from(event.results, result => result[0]?.transcript ?? '').join('').trim();
    onText(heard);
  };
  recognition.onerror = event => console.warn('Speech recognition:', event.error);
  recognition.onend = () => onDone(heard);
  try {
    recognition.start();
  } catch {
    onDone('');
  }
  return () => recognition.stop();
}
