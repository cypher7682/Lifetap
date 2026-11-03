import { html, useState, useEffect, useRef } from "../../vendor/preact-htm.js";
import * as store from "../store.js";
import * as tables from "../tablestore.js";
import * as T from "../table.js";
import * as E from "../engine.js";
import { Icon } from "../icons.js";
import { usePress, Sheet, Popover, MenuItem, IntInput, dialog, confirm, snack, toast, haptic } from "../ui.js";
import { ViewSwitch } from "../viewswitch.js";
import { HowMany } from "./dash.js";
import * as sync from "../sync.js";

const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
const fmt = (n) => (n < 0 ? "−" + Math.abs(n) : String(n));
const ANIM_KEY = "lifetap:dice-anim";
const NAME_KEY = "lifetap:name";
const SHARED_KEY = "lifetap:shared";

/** Splash for a 17th player. The only answer is "Yes". */
export const tooManyPlayers = () =>
  dialog({ title: "Are you taking the piss?", body: `${T.MAX_PLAYERS} players is the limit.`, buttons: [{ label: "Yes", value: true, kind: "primary" }] });

/** ++ from the table: open this table's dash, or ask which one it is first. */
function goCounters(t, nav, ask) {
  if (t.myDash && store.get(t.myDash)) nav.replace({ name: "dash", id: t.myDash });
  else ask();
}

/** Table area size, for working out which way each card faces. */
function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    const read = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return size;
}

const turnClass = (a) => (a === 90 || a === -90 ? " side" : a === 180 ? " flip" : "");

// ---------------------------------------------------------------- player card

function PlayerCard({ p, angle, isMonarch, isFirst, spin, badge, killing, onLife, onHoldLife, onCmdr, onRename, onMonarch, onKill, map }) {
  const minus = usePress({ onTap: () => onLife(-1), onLong: () => onHoldLife(-1), disabled: killing });
  const plus = usePress({ onTap: () => onLife(1), onLong: () => onHoldLife(1), disabled: killing });
  const len = Math.max(1, fmt(p.life).length);
  return html`
    <div class=${"pcard c-" + p.color + turnClass(angle) + (p.dead ? " dead" : "") + (killing ? " killing" : "") + (spin ? " spin-" + spin : "")}
      style=${{ "--a": angle + "deg" }} role="group" aria-label=${`${p.name}, ${p.life} life${p.dead ? ", dead" : ""}`}>
      <div class="pc" style=${{ "--bot": map.rh + 10 + "px" }}>
        <button class="pc-half pc-minus" aria-label=${`${p.name} minus one life. Hold for more.`} ...${minus}><span class="pc-glyph">−</span></button>
        <button class="pc-half pc-plus" aria-label=${`${p.name} plus one life. Hold for more.`} ...${plus}><span class="pc-glyph">+</span></button>
        <div class="pc-rows">
          <div class="pc-top">
            <button class="pc-name" aria-label=${`Rename ${p.name}${isFirst ? " (went first)" : ""}`} onClick=${onRename}>
              ${isFirst && html`<${Icon} name="star" size=${15} class="pc-first" />`}<span>${p.name}</span><${Icon} name="pencil" size=${13} class="pc-pencil" /></button>
          </div>
          <div class="pc-life" style=${{ "--len": len }} aria-hidden="true"><span>${fmt(p.life)}</span></div>
          <div class="pc-bottom" style=${{ width: map.rw + "px", height: map.rh + "px" }}>
            ${!killing && html`<${CmdrMap} ...${map} victim=${p} angle=${angle} onClick=${onCmdr} />`}
          </div>
        </div>
        <button class=${"pc-crown" + (isMonarch ? " on" : "")} aria-label=${isMonarch ? `${p.name} is the Monarch` : `Make ${p.name} the Monarch`} onClick=${onMonarch}>
          <${Icon} name="crown" size=${20} /></button>
        ${badge ? html`<span key=${badge.k} class=${"badge delta-badge pc-badge " + (badge.n < 0 ? "neg" : "pos")}>${signed(badge.n)}</span>` : null}
        ${p.dead && html`<div class="pc-dead" aria-hidden="true"><${Icon} name="skull" size=${64} /></div>`}
        ${killing && html`
          <button class="pc-kill" aria-label=${p.dead ? `Bring ${p.name} back` : `Kill ${p.name}`} onClick=${onKill}>
            <span class="pc-kill-skull"><${Icon} name="skull" size=${56} /></span>
            <span class="pc-kill-name">${p.dead ? `Revive ${p.name}` : p.name}</span>
          </button>`}
      </div>
    </div>`;
}

/**
 * Commander damage at a glance: a little copy of the table, laid out like the real one,
 * with the damage each seat's commander has done to this player. It sits in the card's bottom row
 * but is turned back to the table's real orientation; the numbers face the card's player.
 */
function CmdrMap({ s, grid, w, h, victim, angle, onClick }) {
  const side = angle === 90 || angle === -90;
  return html`
    <button class="cm-map" style=${{ width: w + "px", height: h + "px", gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`, transform: `translate(-50%, -50%) rotate(${-angle}deg)` }}
      aria-label=${`Commander damage to ${victim.name}`} onClick=${onClick}>
      ${s.seats.map((src, i) => {
        const c = grid.cells[i];
        const pair = T.cmdrOf(s, victim.id, src.id);
        const total = pair[0] + pair[1];
        const cw = (w / 2) * c.span, ch = h / grid.rows;
        const wide = side ? ch > cw : cw > ch; // as the reader sees it
        const lethal = src.partners ? Math.max(pair[0], pair[1]) >= T.CMDR_LETHAL : total >= T.CMDR_LETHAL;
        const txt = !total ? "" : src.partners
          ? (wide ? `${pair[0]}/${pair[1]}` : html`${pair[0]}<br />${pair[1]}`)
          : total;
        return html`
          <span key=${src.id} class=${"cmm-cell" + (src.id === victim.id ? " self" : "") + (lethal ? " lethal" : "")}
            style=${{ gridRow: c.row + 1, gridColumn: c.span === 2 ? "1 / span 2" : c.col + 1 }}>
            <span class="cmm-val" style=${{ transform: `rotate(${angle}deg)` }}>${txt}</span>
          </span>`;
      })}
    </button>`;
}

/**
 * Map size for a card: same shape as the table area. Returns its real size (w, h) and the
 * space it takes in the card's own upright frame (rw, rh), which is swapped for sideways cards.
 */
function mapSize(area, cardW, cardH, side) {
  const [cw, ch] = side ? [cardH, cardW] : [cardW, cardH]; // the card as its player sees it
  const [aw, ah] = side ? [area.h, area.w] : [area.w, area.h]; // the table as they see it
  const k = Math.max(0.06, Math.min(ch * 0.26 / ah, cw * 0.5 / aw, 104 / Math.max(aw, ah)));
  const w = Math.round(area.w * k), h = Math.round(area.h * k);
  return { w, h, rw: side ? h : w, rh: side ? w : h };
}

// ---------------------------------------------------------------- commander damage

function CmdrPart({ label, value, onStep, onHold, light }) {
  const minus = usePress({ onTap: () => onStep(-1), onLong: () => onHold(-1) });
  const plus = usePress({ onTap: () => onStep(1), onLong: () => onHold(1) });
  return html`
    <div class=${"cm-part" + (value >= T.CMDR_LETHAL ? " lethal" : "")}>
      <button class="cm-pm" aria-label=${`${label} minus one`} disabled=${value <= 0} ...${minus}>−</button>
      <span class="cm-val">${value}</span>
      <button class="cm-pm" aria-label=${`${label} plus one`} ...${plus}>+</button>
    </div>`;
}

function CmdrSheet({ t, victimId, angles, onStep, onHold, onSplit, onClose }) {
  const s = T.state(t);
  const victim = s.byId[victimId];
  const grid = T.seatGrid(s.seats.length);
  const va = angles[s.seats.findIndex((p) => p.id === victimId)] || 0; // everything faces the player taking the damage
  return html`
    <div class="scrim cm-scrim" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="cm-modal" role="dialog" aria-modal="true" aria-label=${`Commander damage to ${victim.name}`}>
        <div class="cm-head">
          <span class=${"cm-dot bg-" + victim.color}></span>
          <span class="grow">Commander damage to <b>${victim.name}</b></span>
          <button class="btn btn-primary btn-sm" onClick=${onClose}>Done</button>
        </div>
        <div class="cm-grid" style=${{ gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))` }}>
          ${s.seats.map((src, i) => {
            const c = grid.cells[i];
            const pair = T.cmdrOf(s, victimId, src.id);
            const self = src.id === victimId;
            const name = self ? `${src.name} (own)` : src.name;
            return html`
              <div key=${src.id} class=${"cm-cell c-" + src.color + turnClass(va) + (self ? " self" : "")}
                style=${{ "--a": va + "deg", gridRow: c.row + 1, gridColumn: c.span === 2 ? "1 / span 2" : c.col + 1 }}>
                <div class="pc">
                  <div class="cm-name">${name}</div>
                  ${src.partners
                    ? html`
                      <div class="cm-split">
                        <${CmdrPart} label=${`${src.name} I`} value=${pair[0]} onStep=${(d) => onStep(src.id, 0, d)} onHold=${(d) => onHold(src.id, 0, d)} />
                        <${CmdrPart} label=${`${src.name} II`} value=${pair[1]} onStep=${(d) => onStep(src.id, 1, d)} onHold=${(d) => onHold(src.id, 1, d)} />
                      </div>`
                    : html`<${CmdrPart} label=${src.name} value=${pair[0] + pair[1]} onStep=${(d) => onStep(src.id, d < 0 && pair[0] <= 0 ? 1 : 0, d)} onHold=${(d) => onHold(src.id, 0, d)} />`}
                  <button class=${"cm-splitbtn" + (src.partners ? " on" : "")} aria-label=${src.partners ? `Unsplit ${src.name}'s commander` : `Split ${src.name}'s commander (partners)`}
                    onClick=${() => onSplit(src.id, !src.partners)}>${src.partners ? "II" : "I"}</button>
                </div>
              </div>`;
          })}
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- dice

const DICE = [
  { id: "coin", label: "Coin", sides: 2 },
  { id: "d4", label: "d4", sides: 4 },
  { id: "d6", label: "d6", sides: 6 },
  { id: "d8", label: "d8", sides: 8 },
  { id: "d10", label: "d10", sides: 10 },
  { id: "d12", label: "d12", sides: 12 },
  { id: "d20", label: "d20", sides: 20 },
];

/** Outline for each die, in a 100×100 box. */
const DIE_SHAPE = {
  d4: "50,8 94,86 6,86",
  d6: "14,14 86,14 86,86 14,86",
  d8: "50,4 92,50 50,96 8,50",
  d10: "50,4 92,40 50,96 8,40",
  d12: "50,4 93,35 77,90 23,90 7,35",
  d20: "50,3 91,26 91,74 50,97 9,74 9,26",
};

function DiceSheet({ onClose }) {
  const [anim, setAnim] = useState(() => localStorage.getItem(ANIM_KEY) !== "off");
  const [roll, setRoll] = useState(null); // {die, value, rolling, k}
  const timer = useRef(0);
  useEffect(() => () => clearInterval(timer.current), []);
  const go = (die) => {
    clearInterval(timer.current);
    const final = 1 + Math.floor(Math.random() * die.sides);
    const k = Math.random();
    haptic();
    if (!anim || matchMedia("(prefers-reduced-motion: reduce)").matches) return setRoll({ die, value: final, rolling: false, k });
    setRoll({ die, value: final, rolling: true, k });
    if (die.id === "coin") {
      timer.current = setTimeout(() => setRoll((r) => r && r.k === k && { ...r, rolling: false }), 1100);
      return;
    }
    let n = 0;
    timer.current = setInterval(() => {
      n++;
      if (n >= 12) {
        clearInterval(timer.current);
        setRoll((r) => r && r.k === k && { ...r, value: final, rolling: false });
        return;
      }
      setRoll((r) => r && r.k === k && { ...r, value: 1 + Math.floor(Math.random() * die.sides) });
    }, 70);
  };
  const toggleAnim = () => {
    localStorage.setItem(ANIM_KEY, anim ? "off" : "on");
    setAnim(!anim);
  };
  const r = roll;
  return html`
    <${Sheet} onClose=${onClose} label="Dice" class="dice-sheet">
      <div class="dice-stage" aria-live="polite">
        ${!r && html`<div class="dice-hint">Pick something to roll</div>`}
        ${r && r.die.id === "coin" && html`
          <div key=${r.k} class=${"coin " + (r.rolling ? "flipping " : "") + (r.value === 1 ? "heads" : "tails")}>
            <div class="coin-face coin-h">H</div><div class="coin-face coin-t">T</div>
          </div>`}
        ${r && r.die.id !== "coin" && html`
          <div key=${r.k} class=${"die" + (r.rolling ? " tumbling" : "")}>
            <svg viewBox="0 0 100 100" aria-hidden="true"><polygon points=${DIE_SHAPE[r.die.id]} /></svg>
            <span class=${"die-val" + (r.die.id === "d4" ? " low" : "")}>${r.value}</span>
          </div>`}
        ${r && !r.rolling && html`<div class="dice-result">${r.die.id === "coin" ? (r.value === 1 ? "Heads" : "Tails") : `${r.die.label}: ${r.value}`}</div>`}
      </div>
      <div class="dice-btns">
        ${DICE.map((d) => html`<button class=${"btn dice-btn" + (r && r.die.id === d.id ? " picked" : "")} onClick=${() => go(d)}>${d.id === "coin" ? "Heads / tails" : d.label}</button>`)}
      </div>
      <label class="switch-row">
        <span>Animation</span>
        <input type="checkbox" class="switch" checked=${anim} onChange=${toggleAnim} />
      </label>
    <//>`;
}

// ---------------------------------------------------------------- sheets

function PlayersSheet({ t, onAct, onClose }) {
  const s = T.state(t);
  const [name, setName] = useState("");
  const add = async () => {
    if (s.seats.length >= T.MAX_PLAYERS) return tooManyPlayers();
    const n = name.trim() || `Player ${s.seats.length + 1}`;
    onAct([{ op: "add", p: T.newPlayer(t, n) }]);
    setName("");
  };
  return html`
    <${Sheet} onClose=${onClose} label="Players">
      <h2 class="sheet-title">Players <span class="muted small">${s.seats.length} / ${T.MAX_PLAYERS}</span></h2>
      <div class="pl-list">
        ${s.seats.map((p) => html`
          <div class="pl-row" key=${p.id}>
            <span class=${"pl-dot bg-" + p.color}></span>
            <input class="input pl-name" value=${p.name} maxlength="24" aria-label=${`Name of ${p.name}`}
              onKeyDown=${(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur=${(e) => {
                const v = e.currentTarget.value.trim();
                if (v && v !== p.name) onAct([{ op: "rename", p: p.id, name: v, was: p.name }]);
                else e.currentTarget.value = p.name;
              }} />
            ${p.id === t.owner && html`<span class="pl-tag"><${Icon} name="crown" size=${16} /></span>`}
            ${p.id === t.me && html`<span class="pl-tag">you</span>`}
            <button class="icon-btn pl-x" aria-label=${`Remove ${p.name}`} onClick=${() => {
              onAct([{ op: "remove", p: p.id }]);
              snack(`Removed ${p.name}`);
            }}><${Icon} name="x" size=${20} /></button>
          </div>`)}
      </div>
      <div class="pl-add">
        <input class="input grow" value=${name} maxlength="24" placeholder=${`Player ${s.seats.length + 1}`} aria-label="New player's name"
          onInput=${(e) => setName(e.currentTarget.value)} onKeyDown=${(e) => e.key === "Enter" && add()} />
        <button class="btn btn-primary" onClick=${add}><${Icon} name="plus" size=${20} />Add</button>
      </div>
    <//>`;
}

function RenameSheet({ p, turn, onSave, onClose }) {
  const [name, setName] = useState(p.name);
  const save = () => {
    const v = name.trim();
    if (v && v !== p.name) onSave(v);
    onClose();
  };
  return html`
    <${Sheet} onClose=${onClose} turn=${turn} label="Rename player">
      <h2 class="sheet-title">Name</h2>
      <input class="input input-lg" value=${name} maxlength="24" autofocus aria-label="Name"
        onInput=${(e) => setName(e.currentTarget.value)} onKeyDown=${(e) => e.key === "Enter" && save()} />
      <button class="btn btn-primary btn-block" disabled=${!name.trim()} onClick=${save}>Save</button>
    <//>`;
}

function SettingsSheet({ t, onAct, onClose }) {
  const s = T.state(t);
  const [life, setLife] = useState(s.startLife);
  const done = () => {
    if (life !== s.startLife && life > 0) onAct([{ op: "settings", startLife: life }]);
    onClose();
  };
  return html`
    <${Sheet} onClose=${done} label="Table settings">
      <h2 class="sheet-title">Table settings</h2>
      <${LifeField} value=${life} onChange=${setLife} />
      <p class="hint small">Used for new players and when the table is reset.</p>
      <button class="btn btn-primary btn-block" onClick=${done}>Done</button>
    <//>`;
}

export function LifeField({ value, onChange }) {
  return html`
    <div class="field-label">Starting life</div>
    <div class="stepper">
      <button class="step-btn" aria-label="Less" disabled=${value <= 1} onClick=${() => onChange(Math.max(1, value - 1))}><${Icon} name="minus" size=${28} /></button>
      <${IntInput} class="stepper-val stepper-input" label="Starting life" value=${value} onChange=${(n) => onChange(Math.max(1, Math.min(9999, n)))} />
      <button class="step-btn" aria-label="More" onClick=${() => onChange(Math.min(9999, value + 1))}><${Icon} name="plus" size=${28} /></button>
    </div>
    <div class="life-presets">
      ${[20, 25, 30, 40].map((n) => html`<button class=${"btn btn-sm" + (value === n ? " picked" : "")} onClick=${() => onChange(n)}>${n}</button>`)}
    </div>`;
}

function ShareSheet({ t, onClose }) {
  return html`
    <${Sheet} onClose=${onClose} label="Share table">
      <h2 class="sheet-title">Table code</h2>
      <div class="share-code">#${t.code}</div>
      ${t.online
        ? html`<p class="hint center">On another phone: <b>Join table</b> on the home screen, then type this code. ${t.owner === t.me ? "You'll be asked to let them in." : "The table owner lets them in."}</p>`
        : html`<p class="hint small center">This table lives on this phone only, so nobody can join it. Start a new table with “Others can join” on to share one.</p>`}
      <button class="btn btn-primary btn-block" onClick=${onClose}>OK</button>
    <//>`;
}

/** Someone wants in, to the seat they picked: allow, seat them somewhere else, or say no. */
function JoinRequestSheet({ t, req, members, onClose }) {
  const s = T.state(t);
  const claimed = new Set(members.map((m) => m.player));
  const free = s.seats.filter((p) => !claimed.has(p.id));
  const [busy, setBusy] = useState(false);
  const [elsewhere, setElsewhere] = useState(false);
  const go = async (approve, seat) => {
    setBusy(true);
    try { await sync.answer(t.id, req.reqId, approve, seat); onClose(); }
    catch (e) { toast(e.message); setBusy(false); setElsewhere(true); }
  };
  const who = req.name || "Someone";
  const asked = req.seat && free.find((p) => p.id === req.seat);
  const canAdd = s.seats.length < T.MAX_PLAYERS;
  return html`
    <${Sheet} onClose=${onClose} label="Join request">
      <h2 class="sheet-title">${who} wants to join</h2>
      <p class="hint">${asked ? html`They picked <b class=${"c-" + asked.color}>${asked.name}</b>’s seat${req.name && req.name !== asked.name ? `, which becomes ${req.name}` : ""}.` : "They asked for a new seat."}</p>
      <button class="btn btn-primary btn-block" disabled=${busy || (!asked && !canAdd)} onClick=${() => go(true, asked ? asked.id : null)}>
        <${Icon} name="check" size=${20} />Let them in</button>
      ${!elsewhere
        ? html`<button class="btn btn-plain btn-block" disabled=${busy} onClick=${() => setElsewhere(true)}>Seat them somewhere else</button>`
        : html`
          <div class="pick-list">
            ${free.filter((p) => p !== asked).map((p) => html`
              <button class="pick-row" disabled=${busy} onClick=${() => go(true, p.id)}>
                <span class=${"pl-dot bg-" + p.color}></span><span class="grow">${p.name}</span>
              </button>`)}
            ${asked && html`
              <button class="pick-row pick-new" disabled=${busy || !canAdd} onClick=${() => go(true, null)}>
                <span class="pick-icon"><${Icon} name="plus" size=${22} /></span><span class="grow">New player</span>
              </button>`}
          </div>`}
      <button class="btn btn-danger-soft btn-block" disabled=${busy} onClick=${() => go(false)}>Don't let them in</button>
    <//>`;
}

/** Which dash is "yours" for ++ at this table. */
export function PickDashSheet({ t, onPick, onClose }) {
  const dashes = store.list();
  return html`
    <${Sheet} onClose=${onClose} label="Pick your counters">
      <h2 class="sheet-title">Which dash is yours?</h2>
      <p class="hint small">++ will open it while you're at this table. Change it from the table menu.</p>
      <div class="pick-list">
        ${dashes.map((d) => html`
          <button class=${"pick-row" + (t.myDash === d.id ? " picked" : "")} onClick=${() => onPick(d.id)}>
            <span class=${"pick-icon tint-" + d.color}><${Icon} name=${d.icon} size=${24} /></span>
            <span class="grow">${d.name}</span>
            ${t.myDash === d.id && html`<${Icon} name="check" size=${20} />`}
          </button>`)}
        <button class="pick-row pick-new" onClick=${() => {
          const me = T.state(t).byId[t.me];
          const dash = E.createDash({ name: me ? `${me.name}’s counters` : "My counters", count: 4, grid: E.bestGrid(4), index: dashes.length });
          store.put(dash);
          onPick(dash.id);
        }}>
          <span class="pick-icon"><${Icon} name="plus" size=${24} /></span><span class="grow">New dash</span>
        </button>
      </div>
    <//>`;
}

// ---------------------------------------------------------------- screen

export function TableScreen({ id, nav }) {
  const t = tables.get(id);
  const s = T.state(t);
  const area = useRef(null);
  const size = useSize(area);
  const [sheet, setSheet] = useState(null);
  const [killing, setKilling] = useState(false);
  const [, tick] = useState(0);
  const by = tables.deviceId;

  const online = !!t.online;
  const conn = online ? sync.info(id) : null;
  const act = (ops) => (online ? sync.act(id, { ops }) : tables.update(id, (x) => T.act(x, ops, by)));

  // delta badges show this phone's open bundle; re-render when it closes
  const deltas = T.bundleDeltas(t, by);
  const last = t.events[t.events.length - 1];
  useEffect(() => {
    if (!Object.keys(deltas).length) return;
    const ms = T.BUNDLE_MS - (Date.now() - last.tEnd) + 30;
    const h = setTimeout(() => tick((n) => n + 1), Math.max(30, ms));
    return () => clearTimeout(h);
  }, [last && last.tEnd]);

  // spin round the table to whoever goes first, when a start or reset has just picked them
  const [spin, setSpin] = useState(null); // {i: seat index, landed}
  const seenFirst = useRef(null);
  useEffect(() => {
    if (seenFirst.current === s.firstSeq) return;
    // on opening the table, only spin for a pick made just now; after that, for any newer pick (not undos)
    const fresh = seenFirst.current === null
      ? Date.now() - (t.events.find((e) => e.seq === s.firstSeq)?.t || 0) < 3000
      : s.firstSeq > seenFirst.current;
    seenFirst.current = s.firstSeq;
    const target = s.seats.findIndex((p) => p.id === s.first);
    if (!fresh || target < 0) return;
    const order = T.clockwise(s.seats.length);
    const n = order.length;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = reduce || n < 2 ? 0 : 2 * n + order.indexOf(target);
    const timers = [];
    let at = 0;
    for (let k = 0; k < total; k++) {
      at += 55 + 300 * (k / total) ** 3; // slows down as it lands
      timers.push(setTimeout(() => setSpin({ i: order[k % n] }), at));
    }
    timers.push(setTimeout(() => { setSpin({ i: target, landed: true }); haptic(); }, at + 160));
    timers.push(setTimeout(() => setSpin(null), at + 1300));
    return () => timers.forEach(clearTimeout);
  }, [s.firstSeq]);

  const grid = T.seatGrid(s.seats.length);
  const angles = grid.cells.map((c) => (size.w ? T.facing(c, grid.rows, size.w, size.h) : 0));

  const doUndo = () => {
    const e = s.undoable;
    if (!e) return;
    online ? sync.act(id, { kind: "undo" }) : tables.update(id, (x) => T.undo(x, by));
    toast(`Undid ${T.describe(t, e)}`);
  };
  const doRedo = () => {
    const e = s.redoable;
    if (!e) return;
    online ? sync.act(id, { kind: "redo" }) : tables.update(id, (x) => T.redo(x, by));
    toast(`Redid ${T.describe(t, e)}`);
  };
  const undoPress = usePress({ onTap: doUndo, onLong: (el) => setSheet({ type: "undohold", anchor: el }) });

  const leave = async () => {
    setSheet(null);
    if (online) {
      const next = (conn?.members || []).find((m) => m.player !== t.me);
      const body = t.owner === t.me
        ? next ? `Everyone else carries on, and ${next.name || "the next player"} becomes the table owner.` : "Nobody else has joined, so the table closes when it's been idle for an hour."
        : "Everyone else carries on without you.";
      if (!(await confirm("Leave table?", body, "Leave", true))) return;
      await sync.leave(id);
    } else {
      if (!(await confirm("Leave table?", "This table only lives on this phone, so leaving closes it for good.", "Leave", true))) return;
      tables.remove(id);
    }
    nav.back();
  };

  const owner = s.byId[t.owner];
  const close = () => setSheet(null);
  const angleOf = (pid) => angles[s.seats.findIndex((p) => p.id === pid)] || 0;

  let sheetEl = null;
  if (sheet) {
    if (sheet.type === "menu") sheetEl = html`
      <${Popover} anchor=${sheet.anchor} onClose=${close} highlight=${false}>
        <div class="pop-title">Table ${t.code}</div>
        <${MenuItem} icon="users" label="Players" onClick=${() => setSheet({ type: "players" })} />
        <${MenuItem} icon="swap" label="Switch view" onClick=${() => { close(); goCounters(t, nav, () => setSheet({ type: "pick" })); }} />
        <${MenuItem} icon="share" label="Share table" onClick=${() => setSheet({ type: "share" })} />
        <${MenuItem} icon="sliders" label="Table settings" onClick=${() => setSheet({ type: "settings" })} />
        ${t.myDash && store.get(t.myDash) && html`<${MenuItem} icon="layers" label="Change my dash" onClick=${() => setSheet({ type: "pick" })} />`}
        <${MenuItem} icon="reset" label="Reset table" onClick=${async () => {
          close();
          if (await confirm("Reset table?", `Everyone back to ${s.startLife} life, commander damage cleared, everyone alive, and a new first player. Undo brings it all back.`, "Reset", true)) act(T.resetOps(t));
        }} />
        <${MenuItem} icon="leave" label="Leave table" kind="danger" onClick=${leave} />
      <//>`;
    else if (sheet.type === "undohold") sheetEl = html`
      <${Popover} anchor=${sheet.anchor} onClose=${close}>
        <${MenuItem} icon="history" label="View history" onClick=${() => { close(); nav.push({ name: "history", id }); }} />
        ${s.undoable && html`<${MenuItem} icon="undo" label=${`Undo ${T.describe(t, s.undoable)}`} onClick=${() => { close(); doUndo(); }} />`}
      <//>`;
    else if (sheet.type === "players") sheetEl = html`<${PlayersSheet} t=${t} onAct=${act} onClose=${close} />`;
    else if (sheet.type === "rename" && s.byId[sheet.p]) {
      const p = s.byId[sheet.p];
      sheetEl = html`<${RenameSheet} p=${p} turn=${angleOf(p.id)} onClose=${close} onSave=${(name) => act([{ op: "rename", p: p.id, name, was: p.name }])} />`;
    } else if (sheet.type === "settings") sheetEl = html`<${SettingsSheet} t=${t} onAct=${act} onClose=${close} />`;
    else if (sheet.type === "share") sheetEl = html`<${ShareSheet} t=${t} onClose=${close} />`;
    else if (sheet.type === "dice") sheetEl = html`<${DiceSheet} onClose=${close} />`;
    else if (sheet.type === "pick") sheetEl = html`<${PickDashSheet} t=${t} onClose=${close} onPick=${(dashId) => {
      tables.update(id, (x) => ({ ...x, myDash: dashId }));
      close();
      nav.replace({ name: "dash", id: dashId });
    }} />`;
    else if (sheet.type === "life") {
      const p = s.byId[sheet.p];
      if (p) sheetEl = html`<${HowMany} kind="tile" turn=${angleOf(p.id)} onClose=${close}
        tile=${{ name: p.name, icon: "heart", color: p.color, value: p.life, allowNegative: true }}
        onDone=${(n) => { close(); act([{ op: "life", p: p.id, d: n }]); }} />`;
    } else if (sheet.type === "cmdr" || sheet.type === "cmdrhm") {
      const victim = s.byId[sheet.p];
      if (victim) {
        sheetEl = html`<${CmdrSheet} t=${t} victimId=${victim.id} angles=${angles} onClose=${close}
          onStep=${(from, part, d) => act([{ op: "cmdr", to: victim.id, from, part, d }])}
          onHold=${(from, part, d) => setSheet({ ...sheet, type: "cmdrhm", from, part })}
          onSplit=${(from, on) => act([{ op: "partners", p: from, on }])} />`;
        if (sheet.type === "cmdrhm") {
          const src = s.byId[sheet.from];
          const pair = T.cmdrOf(s, victim.id, sheet.from);
          const value = src.partners ? pair[sheet.part] : pair[0] + pair[1];
          const back = () => setSheet({ type: "cmdr", p: victim.id });
          sheetEl = html`${sheetEl}<${HowMany} kind="tile" turn=${angleOf(victim.id)} onClose=${back}
            tile=${{ name: `${src.name}${src.partners ? (sheet.part ? " II" : " I") : ""} → ${victim.name}`, icon: "cmdr", color: src.color, value, allowNegative: false }}
            onDone=${(n) => { back(); act([{ op: "cmdr", to: victim.id, from: src.id, part: sheet.part, d: n }]); }} />`;
        }
      }
    }
  }

  return html`
    <div class="page table-page">
      <header class="dash-head table-head">
        <button class="icon-btn" aria-label="Back to home" onClick=${() => nav.back()}><${Icon} name="back" /></button>
        <button class="head-title title-btn" aria-label=${`Table ${t.code}. Menu`} onClick=${(e) => setSheet({ type: "menu", anchor: e.currentTarget })}>
          <span class="title-text">Table: <span class="tbl-code">#${t.code}</span></span>
          ${online && html`<span class=${"net-dot " + (conn?.status || "connecting")} title=${conn?.status || "connecting"}></span>`}<${Icon} name="chevdown" size=${18} class="title-chev" /></button>
        ${owner && html`<span class="owner-chip" title="Table owner"><${Icon} name="crown" size=${16} /><span>${owner.name}</span></span>`}
        <${ViewSwitch} view="life" onSwitch=${() => goCounters(t, nav, () => setSheet({ type: "pick" }))} />
      </header>
      <div class=${"table-area" + (killing ? " kill-mode" : "") + (s.seats.length > 6 ? " many" : "")} ref=${area} style=${{ gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))` }}>
        ${size.w > 0 && s.seats.map((p, i) => {
          const c = grid.cells[i];
          const badge = deltas[p.id] ? { n: deltas[p.id], k: last.seq } : null;
          return html`
            <div key=${p.id} class="seat" style=${{ gridRow: c.row + 1, gridColumn: c.span === 2 ? "1 / span 2" : c.col + 1 }}>
              <${PlayerCard} p=${p} angle=${angles[i]} isMonarch=${s.monarch === p.id} isFirst=${s.first === p.id && !(spin && !spin.landed)}
                spin=${spin && spin.i === i ? (spin.landed ? "landed" : "hi") : null} badge=${badge} killing=${killing}
                map=${{ s, grid, ...mapSize(size, (size.w / 2) * c.span, size.h / grid.rows, angles[i] === 90 || angles[i] === -90) }}
                onRename=${() => setSheet({ type: "rename", p: p.id })}
                onLife=${(d) => act([{ op: "life", p: p.id, d }])}
                onHoldLife=${() => setSheet({ type: "life", p: p.id })}
                onCmdr=${() => setSheet({ type: "cmdr", p: p.id })}
                onMonarch=${() => act([{ op: "monarch", p: s.monarch === p.id ? null : p.id, was: s.monarch }])}
                onKill=${() => { setKilling(false); act([{ op: "dead", p: p.id, on: !p.dead }]); }} />
            </div>`;
        })}
        ${!s.seats.length && html`
          <div class="table-empty">
            <p>No players at the table.</p>
            <button class="btn btn-primary" onClick=${() => setSheet({ type: "players" })}><${Icon} name="plus" size=${20} />Add players</button>
          </div>`}
      </div>
      <nav class="macro-bar table-rail" aria-label="Table tools">
        <div class="slot">
          <button class="slot-btn rail-btn" aria-label="Dice and coin" onClick=${() => setSheet({ type: "dice" })}><${Icon} name="dice" size=${24} /></button>
          <span class="slot-label muted">Dice</span>
        </div>
        <div class="slot">
          <button aria-label=${s.undoable ? `Undo ${T.describe(t, s.undoable)}. Hold for history.` : "Nothing to undo. Hold for history."} ...${undoPress}
            class=${"slot-btn rail-btn" + (s.undoable ? "" : " off")}><${Icon} name="undo" size=${24} /></button>
          <span class="slot-label muted">Undo</span>
        </div>
        <div class="slot">
          <button class="slot-btn rail-btn" aria-label=${s.redoable ? `Redo ${T.describe(t, s.redoable)}` : "Nothing to redo"} disabled=${!s.redoable} onClick=${doRedo}><${Icon} name="redo" size=${24} /></button>
          <span class="slot-label muted">Redo</span>
        </div>
        <div class="slot">
          <button class=${"slot-btn rail-btn kill-btn" + (killing ? " on" : "")} aria-pressed=${killing} aria-label=${killing ? "Cancel kill mode" : "Kill a player"}
            disabled=${!s.seats.length} onClick=${() => setKilling(!killing)}><${Icon} name="skull" size=${24} /></button>
          <span class=${"slot-label" + (killing ? " rec" : " muted")}>${killing ? "Cancel" : "Kill"}</span>
        </div>
      </nav>
      ${sheetEl}
      ${!sheetEl && online && t.owner === t.me && conn?.requests?.length > 0 && html`
        <${JoinRequestSheet} key=${conn.requests[0].reqId} t=${t} req=${conn.requests[0]} members=${conn.members}
          onClose=${() => { conn.requests = conn.requests.slice(1); tick((n) => n + 1); }} />`}
    </div>`;
}

// ---------------------------------------------------------------- history

const PAGE = 60;

export function HistoryScreen({ id, nav }) {
  const t = tables.get(id);
  const s = T.state(t);
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef(null);
  const events = t.events;
  const total = events.length;
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setShown((n) => n + PAGE));
    io.observe(el);
    return () => io.disconnect();
  }, [shown >= total]);
  const doneSeqs = new Set(s.done.map((e) => e.seq));
  const rows = [];
  for (let i = total - 1; i >= 0 && rows.length < shown; i--) rows.push(events[i]);
  const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return html`
    <div class="page history-page">
      <header class="bar-head">
        <button class="icon-btn round" aria-label="Back" onClick=${() => nav.back()}><${Icon} name="back" /></button>
        <h1 class="head-title center">History</h1>
        <span class="icon-btn-spacer"></span>
      </header>
      <div class="scroll">
        <p class="hint small">Table ${t.code} · ${total} event${total === 1 ? "" : "s"}, newest first</p>
        <ol class="hist-list">
          ${rows.map((e) => {
            const meta = e.kind === "undo" || e.kind === "redo";
            const off = !meta && e.kind === "action" && !doneSeqs.has(e.seq);
            return html`
              <li key=${e.seq} class=${"hist-row" + (meta ? " meta" : "") + (off ? " off" : "")}>
                <span class="hist-seq mono">#${e.seq}</span>
                <span class="hist-text">${T.describe(t, e)}</span>
                <span class="hist-time mono">${time(e.t)}</span>
              </li>`;
          })}
        </ol>
        ${shown < total && html`<div ref=${sentinel} class="hist-more">Loading…</div>`}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- new table

export function NewTable({ nav }) {
  const [me, setMe] = useState(() => localStorage.getItem(NAME_KEY) || "");
  const [others, setOthers] = useState(["", "", ""]);
  const [life, setLife] = useState(T.DEFAULT_LIFE);
  const [shared, setShared] = useState(() => localStorage.getItem(SHARED_KEY) !== "off");
  const [busy, setBusy] = useState(false);
  const setOther = (i, v) => setOthers((o) => o.map((x, j) => (j === i ? v : x)));
  const addRow = () => (others.length + 1 >= T.MAX_PLAYERS ? tooManyPlayers() : setOthers([...others, ""]));
  const start = async () => {
    if (me.trim()) localStorage.setItem(NAME_KEY, me.trim());
    localStorage.setItem(SHARED_KEY, shared ? "on" : "off");
    const names = [me.trim() || "Player 1", ...others.map((n, i) => n.trim() || `Player ${i + 2}`)];
    if (shared) {
      setBusy(true);
      try {
        const id = await sync.create({ names, startLife: life });
        return nav.replace({ name: "table", id });
      } catch (e) {
        setBusy(false);
        const local = await confirm("Couldn't reach the table server", `${e.message} You can still run the table on this phone, but nobody else can join it.`, "Start on this phone");
        if (!local) return;
      }
    }
    const t = T.createTable({ names, startLife: life, by: tables.deviceId });
    tables.put(t);
    nav.replace({ name: "table", id: t.id });
  };
  return html`
    <div class="page new-page">
      <header class="bar-head">
        <button class="icon-btn round" aria-label="Back" onClick=${() => nav.back()}><${Icon} name="back" /></button>
        <h1 class="head-title center">New table</h1>
        <span class="icon-btn-spacer"></span>
      </header>
      <div class="scroll">
        <label class="field-label" for="nt-me">Your name <span class="muted small">(optional)</span></label>
        <input id="nt-me" class="input input-lg" value=${me} maxlength="24" placeholder="Player 1"
          onInput=${(e) => setMe(e.currentTarget.value)} onKeyDown=${(e) => e.key === "Enter" && e.currentTarget.blur()} />

        <div class="field-label">Other players</div>
        <div class="pl-list">
          ${others.map((n, i) => html`
            <div class="pl-row" key=${i}>
              <input class="input pl-name" value=${n} maxlength="24" placeholder=${`Player ${i + 2}`} aria-label=${`Player ${i + 2} name`}
                onInput=${(e) => setOther(i, e.currentTarget.value)} />
              <button class="icon-btn pl-x" aria-label=${`Remove player ${i + 2}`} onClick=${() => setOthers(others.filter((_, j) => j !== i))}><${Icon} name="x" size=${20} /></button>
            </div>`)}
        </div>
        <button class="btn btn-dashed btn-block" onClick=${addRow}><${Icon} name="plus" size=${20} />Add player</button>

        <${LifeField} value=${life} onChange=${setLife} />

        <label class="switch-row">
          <span>Others can join from their phones</span>
          <input type="checkbox" class="switch" checked=${shared} onChange=${() => setShared(!shared)} />
        </label>
      </div>
      <div class="foot">
        <button class="btn btn-primary btn-block btn-xl" disabled=${busy} onClick=${start}>${busy ? "Starting…" : `Start table · ${others.length + 1} players`}</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- join

export function JoinTable({ nav }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) || "");
  const [st, setSt] = useState({ phase: "idle" }); // idle | finding | seats | asking | waiting | error
  const alive = useRef(true);
  useEffect(() => () => (alive.current = false), []);
  const ok = /^[a-z0-9]{4}$/.test(code);

  const find = async () => {
    if (!ok) return;
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim());
    setSt({ phase: "finding" });
    try {
      const r = await sync.lookup(code);
      if (alive.current) setSt({ phase: "seats", ...r });
    } catch (e) {
      setSt({ phase: "error", msg: e.message });
    }
  };

  const join = async (seat) => {
    setSt({ phase: "asking" });
    let req;
    try {
      req = await sync.askToJoin(code, name.trim(), seat);
    } catch (e) {
      return setSt({ phase: "error", msg: e.message });
    }
    setSt({ phase: "waiting" });
    const started = Date.now();
    while (alive.current && Date.now() - started < 130000) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!alive.current) return;
      let a;
      try { a = await sync.joinStatus(req.reqId); } catch { continue; }
      if (a.status === "approved") {
        try {
          await sync.enter(a.tableId, a.token);
        } catch (e) {
          return setSt({ phase: "error", msg: e.message });
        }
        if (alive.current) nav.replace({ name: "table", id: a.tableId });
        return;
      }
      if (a.status === "denied") return setSt({ phase: "error", msg: "The table owner didn't let you in." });
      if (a.status !== "pending") break;
    }
    if (alive.current) setSt({ phase: "error", msg: "Nobody answered. Check the code and try again." });
  };

  const busy = ["finding", "asking", "waiting"].includes(st.phase);
  const locked = busy || st.phase === "seats";
  return html`
    <div class="page new-page">
      <header class="bar-head">
        <button class="icon-btn round" aria-label="Back" onClick=${() => (st.phase === "seats" ? setSt({ phase: "idle" }) : nav.back())}><${Icon} name="back" /></button>
        <h1 class="head-title center">Join a table</h1>
        <span class="icon-btn-spacer"></span>
      </header>
      <div class="scroll">
        <label class="field-label" for="jt-code">Table code</label>
        <div class="code-wrap">
          <span class="code-hash" aria-hidden="true">#</span>
          <input id="jt-code" class="input input-lg code-input" value=${code} maxlength="4" placeholder="ab12" disabled=${locked}
            autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" inputmode="text"
            onInput=${(e) => { const v = e.currentTarget.value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4); e.currentTarget.value = v; setCode(v); }}
            onKeyDown=${(e) => e.key === "Enter" && find()} />
        </div>
        <label class="field-label" for="jt-name">Your name <span class="muted small">(optional)</span></label>
        <input id="jt-name" class="input input-lg" value=${name} maxlength="24" placeholder="Your name" disabled=${locked}
          onInput=${(e) => setName(e.currentTarget.value)} onKeyDown=${(e) => e.key === "Enter" && find()} />

        ${st.phase === "seats" && html`
          <div class="field-label">Where are you sitting?</div>
          <div class="pick-list">
            ${st.seats.map((p) => html`
              <button class="pick-row" onClick=${() => join(p.id)}>
                <span class=${"pl-dot bg-" + p.color}></span><span class="grow">${p.name}${name.trim() && name.trim() !== p.name ? html` <span class="muted small">→ ${name.trim()}</span>` : ""}</span>
              </button>`)}
            ${st.canAdd && html`
              <button class="pick-row pick-new" onClick=${() => join(null)}>
                <span class="pick-icon"><${Icon} name="plus" size=${22} /></span><span class="grow">New seat</span>
              </button>`}
            ${!st.seats.length && !st.canAdd && html`<p class="hint">That table is full.</p>`}
          </div>`}
        ${busy && html`<div class="join-wait"><span class="spinner" aria-hidden="true"></span>${st.phase === "waiting" ? "Waiting for the table owner to let you in…" : "Finding the table…"}</div>`}
        ${st.phase === "error" && html`<div class="field-err join-err">${st.msg}</div>`}
      </div>
      <div class="foot">
        ${busy
          ? html`<button class="btn btn-plain btn-block btn-xl" onClick=${() => { alive.current = false; nav.back(); }}>Cancel</button>`
          : st.phase !== "seats" && html`<button class="btn btn-primary btn-block btn-xl" disabled=${!ok} onClick=${find}>Next</button>`}
      </div>
    </div>`;
}
