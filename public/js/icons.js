import { html } from "../vendor/preact-htm.js";

// 24px grid, 1.8 stroke. Content icons (user-pickable) first, then UI glyphs.
const P = {
  droplet: html`<path d="M12 3.2c-3.2 4.3-6 7.6-6 11a6 6 0 0 0 12 0c0-3.4-2.8-6.7-6-11z" />`,
  hexplus: html`<path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z" /><path d="M12 8.6v6.8M8.6 12h6.8" />`,
  person: html`<circle cx="12" cy="8" r="3.6" /><path d="M5 20.2c.8-3.7 3.6-5.7 7-5.7s6.2 2 7 5.7" />`,
  layers: html`<path d="M12 3.5 3 8.2l9 4.8 9-4.8z" /><path d="m3 12.2 9 4.8 9-4.8" /><path d="m3 16.2 9 4.8 9-4.8" />`,
  heart: html`<path d="M12 20s-7.6-4.6-7.6-10.1A4.3 4.3 0 0 1 12 7.5a4.3 4.3 0 0 1 7.6 2.4C19.6 15.4 12 20 12 20z" />`,
  lightning: html`<path d="M13.2 2.8 5.5 13.4h6l-.9 7.8 7.9-10.7h-6.1z" />`,
  skull: html`<path d="M12 3a7.5 7.5 0 0 0-7.5 7.5c0 2.6 1.3 4.4 3 5.4V19a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5v-3.1c1.7-1 3-2.8 3-5.4A7.5 7.5 0 0 0 12 3z" /><circle cx="9" cy="11" r="1.6" /><circle cx="15" cy="11" r="1.6" /><path d="M10.5 17.2v3.3M13.5 17.2v3.3" />`,
  spiral: html`<path d="M12.6 12.2a.9.9 0 1 1-1.4-1.1 2.1 2.1 0 0 1 3 .2 3.1 3.1 0 0 1-.4 4.3 4.3 4.3 0 0 1-5.9-.6 5.4 5.4 0 0 1 .8-7.5 6.6 6.6 0 0 1 9.1 1 7.6 7.6 0 0 1-.4 9.8" />`,
  chest: html`<path d="M3.6 9.2V7.6A3.4 3.4 0 0 1 7 4.2h10a3.4 3.4 0 0 1 3.4 3.4v1.6" /><rect x="3.6" y="9.2" width="16.8" height="10.6" rx="1.6" /><path d="M3.6 13.2h6.6M13.8 13.2h6.6" /><rect x="10.2" y="11.6" width="3.6" height="3.8" rx=".9" />`,
  altar: html`<path d="M12 2.8v5.4M9.8 4.9h4.4" /><path d="M6.6 9h10.8l-1.2 3H7.8z" /><path d="M9 12v6.2M15 12v6.2" /><path d="M6 18.2h12v2.6H6z" />`,

  back: html`<path d="m14.5 5.5-6.5 6.5 6.5 6.5" />`,
  undo: html`<path d="M9 14.5 4.5 10 9 5.5" /><path d="M4.5 10H14a5.5 5.5 0 0 1 0 11h-3" />`,
  redo: html`<path d="m15 14.5 4.5-4.5L15 5.5" /><path d="M19.5 10H10a5.5 5.5 0 0 0 0 11h3" />`,
  pencil: html`<path d="M4.5 19.5h3.8L19 8.8a2.7 2.7 0 0 0-3.8-3.8L4.5 15.7z" /><path d="m13.5 6.7 3.8 3.8" />`,
  save: html`<path d="M5 4h11.2L20 7.8V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M8 4v4.5h7V4M7.5 20v-6h9v6" />`,
  plus: html`<path d="M12 5v14M5 12h14" />`,
  minus: html`<path d="M5 12h14" />`,
  x: html`<path d="m6 6 12 12M18 6 6 18" />`,
  check: html`<path d="m4.8 12.6 4.6 4.6 9.8-10" />`,
  trash: html`<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l.9 13a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-13" /><path d="M10 10.5v6.5M14 10.5v6.5" />`,
  chevdown: html`<path d="m6.5 9.5 5.5 5.5 5.5-5.5" />`,
  updown: html`<path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4" />`,
  grip: html`<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3" />`,
  reset: html`<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4" /><path d="M4.5 4.5v4h4" />`,
  copy: html`<rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />`,
  grid: html`<rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" />`,
  bar: html`<circle cx="6" cy="17" r="2.5" /><circle cx="12" cy="17" r="2.5" /><circle cx="18" cy="17" r="2.5" /><path d="M4 8h16" />`,
  list: html`<path d="M5 6.5h14M5 12h14M5 17.5h14" />`,
};

const FILLED = {
  play: html`<path d="M8.5 5.6v12.8a.8.8 0 0 0 1.2.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4a.8.8 0 0 0-1.2.7z" />`,
  stop: html`<rect x="6" y="6" width="12" height="12" rx="2" />`,
  dot: html`<circle cx="12" cy="12" r="6" />`,
};

export function Icon({ name, size = 24, class: cls = "", style }) {
  if (FILLED[name]) {
    return html`<svg class=${"ic " + cls} style=${style} width=${size} height=${size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${FILLED[name]}</svg>`;
  }
  return html`<svg class=${"ic " + cls} style=${style} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.plus}</svg>`;
}

export const ICON_LABEL = {
  droplet: "Droplet", hexplus: "Hex plus", person: "Person", layers: "Layers", heart: "Heart",
  lightning: "Lightning", skull: "Skull", spiral: "Spiral", chest: "Treasure chest", altar: "Altar",
};
