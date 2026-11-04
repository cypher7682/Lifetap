import { html, useState } from "../../vendor/preact-htm.js";
import * as tables from "../tablestore.js";
import * as T from "../table.js";
import { Icon } from "../icons.js";
import { usePress, Sheet, IntInput, Segmented } from "../ui.js";

// The dash's Table Life and Table Counter tiles: change life (or a player counter like poison)
// at the live table without leaving your counters. Amounts are changes (−2 = lose two, +1 = gain one).
// Done hands them to the dash, which runs them as #<stat> steps, so random picks and recording
// work exactly like macros.

const PP_KEY = "lifetap:random-split";
const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
const tone = (n) => (n < 0 ? " neg" : n > 0 ? " pos" : "");

/** Play-mode tile. */
export function DamageTile({ turn, onOpen }) {
  const t = tables.current();
  const press = usePress({ onTap: onOpen });
  return html`
    <div class=${"tile damage-tile" + (turn ? " turned" : "")}>
      <button class="tc dmg-btn" style=${turn ? { "--turn": turn + "deg" } : null} aria-label=${t ? `Table Life: change life at table ${t.code}` : "Table Life: no table yet"} ...${press}>
        <span class="dmg-icon"><${Icon} name="heart" size=${26} /></span>
        <span class="dmg-name">Table Life</span>
        <span class="dmg-sub">${t ? html`Table <span class="tbl-code">#${t.code}</span>` : "No table · tap to start one"}</span>
      </button>
    </div>`;
}

/**
 * Table Counter tile: the counter's name and a little copy of the table with each player's count
 * (yours greyed). With no table it says so; tapping then offers to start one.
 */
export function TableCounterTile({ cell, turn, onOpen }) {
  const t = tables.current();
  const press = usePress({ onTap: onOpen });
  if (!t) {
    return html`
      <div class=${"tile tcounter-tile" + (turn ? " turned" : "")}>
        <button class="tc tcn-btn" style=${turn ? { "--turn": turn + "deg" } : null} aria-label=${`${cell.name}: no table. Tap to start one.`} ...${press}>
          <span class="tcn-head"><${Icon} name="table" size=${15} /><span>${cell.name}</span></span>
          <span class="tcn-none">No table<small>tap to start one</small></span>
        </button>
      </div>`;
  }
  const s = T.state(t);
  const seats = s.seats.map((p) => ({ id: p.id, me: p.id === t.me, n: T.counterOf(p, cell.name), name: p.name }));
  const grid = T.seatGrid(seats.length);
  return html`
    <div class=${"tile tcounter-tile" + (turn ? " turned" : "")}>
      <button class="tc tcn-btn" style=${turn ? { "--turn": turn + "deg" } : null}
        aria-label=${`${cell.name}: ${seats.map((p) => `${p.name} ${p.n}`).join(", ")}. Tap to change.`} ...${press}>
        <span class="tcn-head"><${Icon} name="table" size=${15} /><span>${cell.name}</span></span>
        <span class="tcn-map" style=${{ gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))` }}>
          ${seats.map((p, i) => {
            const c = grid.cells[i];
            return html`<span key=${p.id} class=${"tcn-cell" + (p.me ? " self" : "")}
              style=${{ gridRow: c.row + 1, gridColumn: c.span === 2 ? "1 / span 2" : c.col + 1 }}><b>${p.n}</b></span>`;
          })}
        </span>
      </button>
    </div>`;
}

function DmgCard({ p, n, self, cell, onStep, now, floor }) {
  const minus = usePress({ onTap: () => onStep(-1) });
  const plus = usePress({ onTap: () => onStep(1) });
  return html`
    <div class=${"dmg-card c-" + p.color + (self ? " self" : "") + (p.dead ? " dead" : "") + (n ? " on" : "")}
      style=${{ gridRow: cell.row + 1, gridColumn: cell.span === 2 ? "1 / span 2" : cell.col + 1 }}>
      <div class="dmg-card-name">${self ? `${p.name} (you)` : p.name} <span class="dmg-now">${now}${n ? ` → ${Math.max(floor, now + n)}` : ""}</span></div>
      <div class="dmg-main">
        <button class="dmg-pm" aria-label=${`${p.name} loses one more`} ...${minus}>−</button>
        <span class=${"dmg-val" + tone(n)} aria-live="polite">${signed(n)}</span>
        <button class="dmg-pm" aria-label=${`${p.name} gains one more`} ...${plus}>+</button>
      </div>
      <div class="dmg-tens">
        ${[-100, -10, 10, 100].map((d) => html`<button class="dmg-ten" onClick=${() => onStep(d)}>${signed(d)}</button>`)}
      </div>
    </div>`;
}

function RandomRow({ label, n, onStep }) {
  return html`
    <div class=${"dmg-rand" + (n ? " on" : "")}>
      <span class="dmg-rand-label">${label}</span>
      <div class="dmg-rand-ctl">
        ${[-10, -1].map((d) => html`<button class="dmg-ten" onClick=${() => onStep(d)}>${signed(d)}</button>`)}
        <span class=${"dmg-rand-val" + tone(n)} aria-live="polite">${signed(n)}</span>
        ${[1, 10].map((d) => html`<button class="dmg-ten" onClick=${() => onStep(d)}>${signed(d)}</button>`)}
      </div>
    </div>`;
}

/**
 * "Damage allocation": random opponent / random player rows, then the table's seats.
 * onDone([{key, d}]): key "opponentRandom" | "playerRandom" | "me" | "name:<player>", d = life change.
 */
export function DamageSheet({ turn = 0, stat = "life", onClose, onDone }) {
  const t = tables.current();
  const [amt, setAmt] = useState({});
  const [perPoint, setPerPoint] = useState(() => localStorage.getItem(PP_KEY) !== "total");
  const isLife = stat === "life";
  if (!t) return null;
  const seats = T.state(t).seats;
  const grid = T.seatGrid(seats.length);
  const pre = stat + "|";
  const keyOf = (p) => pre + (p.id === t.me ? "me" : "name:" + p.name);
  const now = (p) => (isLife ? p.life : T.counterOf(p, stat));
  const step = (key, d) => setAmt((a) => ({ ...a, [key]: (a[key] || 0) + d }));
  const isRand = (key) => key.endsWith("|opponentRandom") || key.endsWith("|playerRandom");
  const alloc = Object.entries(amt).filter(([, d]) => d).map(([key, d]) => ({ key: isRand(key) && perPoint ? key + "~pp" : key, d }));
  const pick = (v) => { localStorage.setItem(PP_KEY, v ? "per" : "total"); setPerPoint(v); };
  const hurts = alloc.some((a) => a.d < 0);
  return html`
    <${Sheet} onClose=${onClose} turn=${turn} label=${isLife ? "Table life" : stat} class="dmg-sheet">
      <h2 class="sheet-title">${isLife ? "Table life" : stat} <span class="muted small">Table <span class="tbl-code">#${t.code}</span></span></h2>
      <${RandomRow} label="Random opponent" n=${amt[pre + "opponentRandom"] || 0} onStep=${(d) => step(pre + "opponentRandom", d)} />
      <${RandomRow} label="Random player" n=${amt[pre + "playerRandom"] || 0} onStep=${(d) => step(pre + "playerRandom", d)} />
      <div class="dmg-pp">
        <${Segmented} label="How random amounts are shared" value=${perPoint} onChange=${pick}
          options=${[{ value: true, label: "Per point" }, { value: false, label: "Total" }]} />
        <p class="hint small">${perPoint ? "Each point goes to its own random pick." : "The whole amount goes to one random pick."}</p>
      </div>
      <div class="dmg-break" role="separator"></div>
      <div class="dmg-grid" style=${{ gridTemplateRows: `repeat(${grid.rows}, auto)` }}>
        ${seats.map((p, i) => html`<${DmgCard} key=${p.id} p=${p} n=${amt[keyOf(p)] || 0} now=${now(p)} floor=${isLife ? -Infinity : 0} self=${p.id === t.me} cell=${grid.cells[i]} onStep=${(d) => step(keyOf(p), d)} />`)}
      </div>
      <div class="sheet-row dmg-actions">
        <button class="btn btn-plain" onClick=${onClose}>Cancel</button>
        <button class=${"btn " + (hurts ? "btn-take" : "btn-primary")} disabled=${!alloc.length} onClick=${() => onDone(alloc)}>Done</button>
      </div>
    <//>`;
}

/**
 * No table yet: start one right here, just by saying how many players. It's a normal table:
 * this phone can run it for everyone, and anyone can join with the code later.
 */
export function QuickTableSheet({ turn = 0, onClose, onStart }) {
  const [n, setN] = useState(4);
  const [busy, setBusy] = useState(false);
  const set = (x) => setN(Math.max(1, Math.min(T.MAX_PLAYERS, x)));
  return html`
    <${Sheet} onClose=${onClose} turn=${turn} label="No table">
      <h2 class="sheet-title">No table</h2>
      <p class="hint">Start a table for this game. This phone can run it for everyone, and anyone who wants to can join later from their phone with the code. Rename players from the table view.</p>
      <div class="field-label">How many players?</div>
      <div class="stepper">
        <button class="step-btn" aria-label="Fewer players" disabled=${n <= 1} onClick=${() => set(n - 1)}><${Icon} name="minus" size=${28} /></button>
        <${IntInput} class="stepper-val stepper-input" label="How many players" value=${n} onChange=${set} />
        <button class="step-btn" aria-label="More players" disabled=${n >= T.MAX_PLAYERS} onClick=${() => set(n + 1)}><${Icon} name="plus" size=${28} /></button>
      </div>
      <button class="btn btn-primary btn-block btn-xl" disabled=${busy} onClick=${async () => { setBusy(true); await onStart(n); setBusy(false); }}>
        ${busy ? "Starting…" : `Start table · ${n} player${n === 1 ? "" : "s"}`}</button>
    <//>`;
}
