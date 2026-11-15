// Phones (the website on a phone, for demos): the app is laid out for the glasses' 600×600, and
// squeezed into a 375 px wide screen its rows wrapped and the ask field shrank to a sliver. So on
// any screen smaller than 600 px either way, #root keeps a 600 px layout on the shorter side and
// is zoomed down to fit, filling the screen, over the kitchen photo. The glasses (exactly 600×600) and laptops are left
// alone. Web-only: a native port draws at the display's own size.

function fit() {
  const root = document.getElementById('root');
  if (!root) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scale = Math.min(1, width / 600, height / 600);
  // The kitchen photo shows behind the app on phones too (styles.css), as on a laptop.
  document.documentElement.classList.toggle('small-screen', scale < 1);
  if (scale >= 1) {
    root.style.removeProperty('zoom');
    root.style.removeProperty('width');
    root.style.removeProperty('height');
    return;
  }
  root.style.zoom = String(scale);
  root.style.width = `${width / scale}px`;
  root.style.height = `${height / scale}px`;
}

/** Keeps the app fitted to small screens, now and on every resize or rotation. */
export function fitSmallScreens() {
  fit();
  window.addEventListener('resize', fit);
}
