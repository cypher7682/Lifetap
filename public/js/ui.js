import { html, useState, useEffect, useRef } from "../vendor/preact-htm.js";
import { Icon } from "./icons.js";

export const LONG_PRESS_MS = 450;

// ---------------------------------------------------------------- global overlays

const overlay = { dialog: null, snack: null, splash: null };
const overlayListeners = new Set();
const emitOverlay = () => overlayListeners.forEach((l) => l());
let snackTimer = null;
let splashTimer = null;

/** Promise-based dialog. buttons: [{label, value, kind: "primary"|"danger"|"plain"}] */
export function dialog({ title, body, buttons }) {
  return new Promise((resolve) => {
    overlay.dialog = {
      title, body, buttons,
      resolve: (v) => { overlay.dialog = null; emitOverlay(); resolve(v); },
    };
    emitOverlay();
  });
}

export function confirm(title, body, okLabel = "OK", danger = false) {
  return dialog({
    title, body,
    buttons: [
      { label: "Cancel", value: false, kind: "plain" },
      { label: okLabel, value: true, kind: danger ? "danger" : "primary" },
    ],
  });
}

/** Snackbar: one at a time. With an action it lasts 5s (undo), otherwise 2.5s. */
export function snack(text, action = null, onAction = null) {
  clearTimeout(snackTimer);
  overlay.snack = { text, action, onAction, key: Math.random() };
  emitOverlay();
  snackTimer = setTimeout(() => { overlay.snack = null; emitOverlay(); }, action ? 5000 : 2500);
}
export const toast = (text) => snack(text);

/** Brief centred error splash, e.g. a macro rejected for going negative. */
export function splash(text) {
  clearTimeout(splashTimer);
  overlay.splash = { text, key: Math.random() };
  emitOverlay();
  haptic();
  splashTimer = setTimeout(() => { overlay.splash = null; emitOverlay(); }, 2600);
}

function useOverlay() {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    overlayListeners.add(l);
    return () => overlayListeners.delete(l);
  }, []);
  return overlay;
}

export function Overlays() {
  const o = useOverlay();
  return html`
    ${o.dialog && html`
      <div class="scrim dialog-scrim" onClick=${(e) => e.target === e.currentTarget && o.dialog.resolve(o.dialog.buttons[0].value)}>
        <div class="dialog" role="alertdialog" aria-modal="true" aria-label=${o.dialog.title}>
          <h2>${o.dialog.title}</h2>
          ${o.dialog.body && html`<p>${o.dialog.body}</p>`}
          <div class="dialog-btns">
            ${o.dialog.buttons.map((b) => html`
              <button class=${"btn btn-" + (b.kind || "plain")} onClick=${() => o.dialog.resolve(b.value)}>${b.label}</button>`)}
          </div>
        </div>
      </div>`}
    ${o.splash && html`
      <div class="splash" key=${o.splash.key} role="alert" onClick=${() => { overlay.splash = null; emitOverlay(); }}>
        <span class="splash-icon" aria-hidden="true">!</span>
        <span>${o.splash.text}</span>
      </div>`}
    ${o.snack && html`
      <div class="snack" key=${o.snack.key} role="status">
        <span>${o.snack.text}</span>
        ${o.snack.action && html`
          <button class="snack-act" onClick=${() => { const f = o.snack.onAction; overlay.snack = null; emitOverlay(); f && f(); }}>${o.snack.action}</button>`}
      </div>`}
  `;
}

// ---------------------------------------------------------------- long-press

export function haptic() {
  try { navigator.vibrate && navigator.vibrate(12); } catch {}
}

/**
 * Pointer handlers for tap vs long-press. Spread the result onto an element.
 * Tap comes through onClick (so keyboard works); a long-press swallows the click.
 */
export function usePress({ onTap, onLong, disabled = false }) {
  const st = useRef({ timer: 0, fired: false, x: 0, y: 0 });
  const cancel = () => clearTimeout(st.current.timer);
  if (disabled) return { disabled: true };
  return {
    onPointerDown: (e) => {
      if (e.button > 0) return;
      // a press on a nested button belongs to that button, not this element
      const inner = e.target.closest && e.target.closest("button");
      if (inner && inner !== e.currentTarget && e.currentTarget.contains(inner)) return;
      const el = e.currentTarget;
      const s = st.current;
      s.fired = false;
      s.x = e.clientX;
      s.y = e.clientY;
      cancel();
      if (onLong) {
        s.timer = setTimeout(() => {
          s.fired = true;
          haptic();
          onLong(el);
        }, LONG_PRESS_MS);
      }
    },
    onPointerMove: (e) => {
      const s = st.current;
      if (Math.abs(e.clientX - s.x) > 10 || Math.abs(e.clientY - s.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e) => e.preventDefault(),
    onClick: (e) => {
      if (st.current.fired) {
        st.current.fired = false;
        e.preventDefault();
        return;
      }
      onTap && onTap(e);
    },
  };
}

// ---------------------------------------------------------------- sheets & popovers

/** Bottom sheet. With `turn`, the sheet sits on the physical bottom edge of a turned phone. */
export function Sheet({ onClose, children, turn = 0, label, class: cls = "" }) {
  const inner = html`
    <div class=${"sheet " + cls} role="dialog" aria-modal="true" aria-label=${label}>
      <div class="sheet-grab" aria-hidden="true"></div>
      ${children}
    </div>`;
  return html`
    <div class="scrim sheet-scrim" onClick=${(e) => e.target === e.currentTarget && onClose && onClose()}>
      ${turn ? html`<div class="rotview" style=${{ "--turn": turn + "deg" }} onClick=${(e) => e.target === e.currentTarget && onClose && onClose()}>${inner}</div>` : inner}
    </div>`;
}

/** Offset of `el` relative to `root`, ignoring CSS transforms (works inside the rotated root). */
export function offsetWithin(el, root) {
  let x = 0, y = 0, n = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/**
 * Popover menu anchored to an element (above it if there's room, else below).
 * Rendered inside `.screen`, positioned in its own coordinate space.
 */
export function Popover({ anchor, onClose, children, highlight = true, width = 250 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const screen = anchor.closest(".screen");
    const a = offsetWithin(anchor, screen);
    const sw = screen.offsetWidth;
    const h = ref.current.offsetHeight;
    const left = Math.max(12, Math.min(sw - width - 12, a.x + a.w / 2 - width / 2));
    let top = a.y - h - 10;
    if (top < 12) top = a.y + a.h + 10;
    setPos({ left, top, a });
  }, [anchor]);
  return html`
    <div class="scrim pop-scrim" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      ${highlight && pos && html`<div class="pop-hole" style=${{ left: pos.a.x - 4, top: pos.a.y - 4, width: pos.a.w + 8, height: pos.a.h + 8 }} onClick=${onClose}></div>`}
      <div class="popover" ref=${ref} role="menu" style=${{ width, left: pos ? pos.left : -9999, top: pos ? pos.top : 0 }}>${children}</div>
    </div>`;
}

export function MenuItem({ icon, label, onClick, kind = "", dot = false }) {
  return html`
    <button class=${"menu-item " + kind} role="menuitem" onClick=${onClick}>
      ${dot ? html`<span class="rec-dot" aria-hidden="true"></span>` : html`<${Icon} name=${icon} size=${20} />`}
      <span>${label}</span>
    </button>`;
}

/** Segmented control. options: [{value, label}] */
export function Segmented({ value, options, onChange, label }) {
  return html`
    <div class="seg" role="radiogroup" aria-label=${label}>
      ${options.map((o) => html`
        <button role="radio" aria-checked=${value === o.value} class=${value === o.value ? "on" : ""} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
    </div>`;
}

/** Text input for integers that tolerates "-" while typing. */
export function IntInput({ value, onChange, class: cls = "", label, ...rest }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (parseInt(text, 10) !== value) setText(String(value));
  }, [value]);
  return html`<input class=${"input " + cls} type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off" aria-label=${label}
    value=${text}
    onInput=${(e) => {
      const t = e.currentTarget.value.replace(/[−–]/g, "-");
      setText(t);
      if (/^[-+]?\d+$/.test(t.trim())) onChange(parseInt(t, 10));
    }}
    onBlur=${() => setText(String(value))}
    ...${rest} />`;
}
