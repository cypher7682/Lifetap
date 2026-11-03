import { html } from "../vendor/preact-htm.js";
import { Icon } from "./icons.js";

/**
 * Heart / ++ switch between the table's life view and your counters dash.
 * `view` is where you are now: "life" lights the red heart, "counters" lights the green ++.
 * Reusable: drop it in any header or rail and handle onSwitch.
 */
export function ViewSwitch({ view, onSwitch, style }) {
  const life = view === "life";
  return html`
    <button class=${"view-switch " + (life ? "on-life" : "on-counters")} style=${style}
      aria-label=${life ? "Switch to your counters" : "Switch to the table"} onClick=${onSwitch}>
      <span class="vs-heart"><${Icon} name="heart" size=${20} /></span>
      <span class="vs-slash" aria-hidden="true"></span>
      <span class="vs-plus" aria-hidden="true">
        <${Icon} name="plus" size=${13} class="vs-p1" /><${Icon} name="plus" size=${13} class="vs-p2" />
      </span>
    </button>`;
}
