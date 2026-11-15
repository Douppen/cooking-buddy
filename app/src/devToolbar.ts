// Demo aids on a laptop screen (hidden at the glasses' 600×600, see styles.css): a key help
// at the top of the screen (arrows navigate, Enter clicks, Esc goes back; the toolkit already maps
// Esc to Back), on the cooking screen a note beside the window pointing at the ask field
// (three tips taking turns: ask, change an ingredient, set a timer),
// and a tiny switch, bottom right, that puts the app on a solid black window and hides both. Plain DOM, not UI Toolkit: they aren't part of the glasses app,
// so a native port leaves them out.

const SOLID_KEY = 'cooking-buddy:dev:solid-window';

function readSolid(): boolean {
  try {
    return window.localStorage.getItem(SOLID_KEY) === 'on';
  } catch {
    return false;
  }
}

function writeSolid(on: boolean) {
  try {
    window.localStorage.setItem(SOLID_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the setting just lasts until reload.
  }
}

const KEY_HELP = `
  <div class="key-help__group">
    <div class="key-help__arrows">
      <kbd class="key-help__up">↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd>
    </div>
    <span>Navigate</span>
  </div>
  <div class="key-help__group"><kbd>return</kbd><span>Click</span></div>
  <div class="key-help__group"><kbd>esc</kbd><span>Back</span></div>
`;

// The ask note's tips, one at a time, each with something to try saying.
const ASK_TIPS = [
  {title: 'Ask anything about the recipe', example: 'Can I make this ahead?'},
  {title: 'Change an ingredient', example: "I don't have butter, use oil"},
  {title: 'Set a timer', example: 'Set a timer for 10 minutes'},
];
// Without a click on ‹ or ›, the next tip comes after this long.
const TIP_MS = 10_000;

let tipIndex = 0;
let tipTimer: number | undefined;
let showTip: (index: number) => void = () => {};

/** Shows tip `index` and gives it the full TIP_MS before moving on. */
function goToTip(index: number) {
  showTip((index + ASK_TIPS.length) % ASK_TIPS.length);
  window.clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => goToTip(tipIndex + 1), TIP_MS);
}

/** Shows the ask note beside the window while the cooking screen is open (Cooking.tsx). */
export function showAskHint(on: boolean) {
  const root = document.documentElement;
  // Each time the cooking screen opens, start again at tip 1.
  if (on && !root.classList.contains('demo-cooking')) goToTip(0);
  else if (!on) window.clearTimeout(tipTimer);
  root.classList.toggle('demo-cooking', on);
}

/** Adds the key help, the ask note and the switch to the page. */
export function mountDevToolbar() {
  document.querySelector('.dev-toolbar')?.remove();
  document.querySelector('.key-help')?.remove();
  document.querySelector('.ask-hint')?.remove();

  const askHint = document.createElement('div');
  askHint.className = 'ask-hint';
  askHint.setAttribute('role', 'note');
  // All tips sit in one spot (the note fits the tallest); only the current one shows.
  // ‹ and › step through them, "1 / 3" between.
  askHint.innerHTML = `
    <div class="ask-hint__tips">
      ${ASK_TIPS.map(
        tip => `
        <div class="ask-hint__tip">
          <strong class="ask-hint__title">${tip.title}</strong>
          <span>Try saying "${tip.example}"</span>
        </div>`,
      ).join('')}
    </div>
    <div class="ask-hint__nav">
      <button type="button" class="ask-hint__step" data-step="-1" aria-label="Previous tip">‹</button>
      <span class="ask-hint__count"></span>
      <button type="button" class="ask-hint__step" data-step="1" aria-label="Next tip">›</button>
    </div>
    <button type="button" class="ask-hint__close" aria-label="Hide this note" title="Hide">×</button>
  `;
  const tips = [...askHint.querySelectorAll<HTMLElement>('.ask-hint__tip')];
  const count = askHint.querySelector<HTMLElement>('.ask-hint__count')!;
  showTip = index => {
    tipIndex = index;
    tips.forEach((tip, i) => tip.classList.toggle('ask-hint__tip--current', i === index));
    count.textContent = `${index + 1} / ${ASK_TIPS.length}`;
  };
  showTip(0);
  askHint.querySelectorAll<HTMLButtonElement>('.ask-hint__step').forEach(button =>
    button.addEventListener('click', () => {
      goToTip(tipIndex + Number(button.dataset.step));
      // Hand the keyboard back to the glasses app (arrows and Enter drive it).
      button.blur();
    }),
  );
  // × hides the note until the page is reloaded.
  askHint.querySelector('.ask-hint__close')?.addEventListener('click', event => {
    document.documentElement.classList.add('ask-hint-closed');
    // Hand the keyboard back to the glasses app (arrows and Enter drive it).
    (event.currentTarget as HTMLElement).blur();
  });
  document.body.append(askHint);
  // Leaving the cooking screen (Esc, Back) starts the fade-out at once: the screen itself
  // stays mounted until the page transition ends, which made the note linger.
  window.addEventListener('popstate', () => {
    if (!window.location.pathname.startsWith('/cook/')) showAskHint(false);
  });

  const help = document.createElement('div');
  help.className = 'key-help';
  help.setAttribute('role', 'note');
  help.setAttribute('aria-label', 'Arrow keys navigate, Return clicks, Esc goes back');
  help.innerHTML = KEY_HELP;
  document.body.insertBefore(help, document.getElementById('root'));

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dev-toolbar';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-label', 'Solid black window, no key help');
  toggle.title = 'Solid black window, no key help';
  toggle.innerHTML = '<span class="dev-toolbar__switch" aria-hidden="true"></span>';

  const apply = (on: boolean) => {
    document.documentElement.classList.toggle('solid-window', on);
    toggle.setAttribute('aria-checked', String(on));
  };

  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-checked') !== 'true';
    writeSolid(on);
    apply(on);
    // Hand the keyboard back to the glasses app (arrows and Enter drive it).
    toggle.blur();
  });

  document.body.append(toggle);
  apply(readSolid());
}
