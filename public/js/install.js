import { html, useState, useEffect } from "../vendor/preact-htm.js";
import { Icon } from "./icons.js";

// "Add to Home Screen" splash for people opening the link in a mobile browser.

const DISMISS_KEY = "counter-dash:install-dismissed";

// Chrome/Edge/Samsung on Android fire this when the app is installable; keep it for the Install button.
let deferredPrompt = null;
const promptListeners = new Set();
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  promptListeners.forEach((l) => l());
});
window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  promptListeners.forEach((l) => l());
});

export const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function platform() {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS/.test(ua) ? "ios-other" : "ios-safari";
  if (/Android/.test(ua)) return "android";
  return matchMedia("(pointer: coarse)").matches ? "android" : "desktop";
}

/** Whether the list screen should offer installing at all. */
export function canOfferInstall() {
  return !isStandalone() && platform() !== "desktop";
}

export function installDismissed() {
  return localStorage.getItem(DISMISS_KEY) === "1";
}

function Step({ n, children }) {
  return html`<li class="inst-step"><span class="inst-n">${n}</span><span class="inst-text">${children}</span></li>`;
}

const Glyph = ({ name }) => html`<span class="inst-glyph"><${Icon} name=${name} size=${18} /></span>`;

export function InstallSplash({ onClose }) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    promptListeners.add(l);
    return () => promptListeners.delete(l);
  }, []);
  const plat = platform();
  const close = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    onClose();
  };
  const install = async () => {
    const p = deferredPrompt;
    if (!p) return;
    p.prompt();
    const choice = await p.userChoice.catch(() => null);
    deferredPrompt = null;
    if (choice && choice.outcome === "accepted") close();
    else force((n) => n + 1);
  };

  let steps;
  if (plat === "ios-safari" || plat === "ios-other") {
    steps = html`
      <${Step} n="1">Tap <b>Share</b> <${Glyph} name="share" />${plat === "ios-other" ? " — it's in the address bar in Chrome" : " in Safari's toolbar"}</${Step}>
      <${Step} n="2">Scroll down and tap <b>Add to Home Screen</b> <${Glyph} name="addsquare" /></${Step}>
      <${Step} n="3">Tap <b>Add</b>, then open Counter Dash from your home screen</${Step}>`;
  } else if (deferredPrompt) {
    steps = html`
      <${Step} n="1">Tap <b>Install</b> below</${Step}>
      <${Step} n="2">Open Counter Dash from your home screen or app drawer</${Step}>`;
  } else {
    steps = html`
      <${Step} n="1">Open your browser's menu <${Glyph} name="dotsv" /></${Step}>
      <${Step} n="2">Tap <b>Install app</b> or <b>Add to Home screen</b> <${Glyph} name="download" /></${Step}>
      <${Step} n="3">Open Counter Dash from your home screen</${Step}>`;
  }

  return html`
    <div class="scrim inst-scrim" onClick=${(e) => e.target === e.currentTarget && close()}>
      <div class="inst-card" role="dialog" aria-modal="true" aria-labelledby="inst-title">
        <img class="inst-icon" src="icons/icon-192.png" alt="" width="76" height="76" />
        <h2 id="inst-title">Put Counter Dash on your home screen</h2>
        <p class="inst-lede">It runs full-screen like a normal app and works with no signal once it's installed.</p>
        <ol class="inst-steps">${steps}</ol>
        <p class="inst-note"><${Icon} name="home" size=${16} /> Install before you build your dashes — the browser and the installed app keep separate data.</p>
        <div class="inst-btns">
          <button class="btn btn-plain" onClick=${close}>Not now</button>
          ${deferredPrompt && plat === "android" && html`<button class="btn btn-primary" onClick=${install}><${Icon} name="download" size=${20} />Install</button>`}
        </div>
      </div>
    </div>`;
}
