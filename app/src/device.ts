// What the app runs on. The glasses get Neural Band swipes and pinches as keys; the website on a
// phone or tablet gets taps and finger swipes instead (the toolkit handles neither), so a few
// controls also answer a tap there. Web-only: a native port has its own input.

/** The glasses' browser, as the UI Toolkit recognises it ("Greatwhite" in an Android web view). */
export function onGlasses(): boolean {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return ua.includes('Greatwhite') || ua.includes('; wv)');
}

/** The website on a phone or tablet: a touch screen that isn't the glasses. */
export function onTouchScreen(): boolean {
  if (typeof window === 'undefined' || onGlasses()) return false;
  return window.matchMedia('(hover: none), (pointer: coarse)').matches;
}
