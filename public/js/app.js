import { html, render, useState, useEffect, useRef } from "../vendor/preact-htm.js";
import * as store from "./store.js";
import { Overlays, setRootTurn } from "./ui.js";
import { DashList } from "./screens/list.js";
import { NewDash } from "./screens/newdash.js";
import { DashScreen } from "./screens/dash.js";
import { MacroEditor } from "./screens/editor.js";

const LAST_KEY = "counter-dash:last";

function useStore() {
  const [, set] = useState(0);
  useEffect(() => store.subscribe(() => set((n) => n + 1)), []);
}

/**
 * Viewport orientation on touch devices. If the OS rotates the page to
 * landscape, the whole portrait layout is counter-rotated so it stays put
 * physically, and dash tiles turn their contents upright (spec §4.9).
 */
function useAutoTurn() {
  const read = () => {
    const w = window.innerWidth, h = window.innerHeight;
    const touch = matchMedia("(pointer: coarse)").matches;
    if (!touch || w <= h) return { turn: 0, w, h };
    const angle = screen.orientation ? screen.orientation.angle : window.orientation;
    // 90: phone turned anticlockwise (top to the left)
    return { turn: angle === 270 || angle === -90 ? -90 : 90, w, h };
  };
  const [s, set] = useState(read);
  useEffect(() => {
    const on = () => set(read());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", () => setTimeout(on, 50));
    screen.orientation?.addEventListener?.("change", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return s;
}

function App() {
  useStore();
  const auto = useAutoTurn();
  setRootTurn(-auto.turn);
  const [stack, setStack] = useState(() => {
    const s = [{ name: "list" }];
    const last = localStorage.getItem(LAST_KEY);
    if (last && store.get(last)) s.push({ name: "dash", id: last });
    return s;
  });
  const guard = useRef(null);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  useEffect(() => {
    history.replaceState({ depth: 0 }, "");
    for (let i = 1; i < stack.length; i++) history.pushState({ depth: i }, "");
    const onPop = async () => {
      if (stackRef.current.length <= 1) return;
      if (guard.current) {
        // keep our place in history while the guard decides
        history.pushState({ depth: stackRef.current.length - 1 }, "");
        const ok = await guard.current();
        if (!ok) return;
        guard.current = null;
        history.back(); // re-enters onPop with no guard
        return;
      }
      setStack((s) => s.slice(0, -1));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const top = stack[stack.length - 1];

  useEffect(() => {
    if (top.name === "dash") localStorage.setItem(LAST_KEY, top.id);
    else if (top.name === "list") localStorage.removeItem(LAST_KEY);
  }, [top]);

  const nav = {
    push(route) {
      guard.current = null;
      history.pushState({ depth: stackRef.current.length }, "");
      setStack((s) => [...s, route]);
    },
    /** Replace the top route without touching history. */
    replace(route) {
      guard.current = null;
      setStack((s) => [...s.slice(0, -1), route]);
    },
    back() {
      history.back();
    },
    /** Leave without running the guard (after the screen already handled it). */
    forceBack() {
      guard.current = null;
      history.back();
    },
    /** fn: () => Promise<boolean> — return false to stay. */
    setGuard(fn) {
      guard.current = fn;
    },
  };

  let screenEl;
  if (top.name === "new") screenEl = html`<${NewDash} nav=${nav} />`;
  else if (top.name === "dash" && store.get(top.id)) screenEl = html`<${DashScreen} key=${top.id} id=${top.id} nav=${nav} autoTurn=${auto.turn} />`;
  else if (top.name === "macro" && store.get(top.id)) screenEl = html`<${MacroEditor} key=${top.macroId} id=${top.id} macroId=${top.macroId} nav=${nav} />`;
  else if (top.name === "trigger" && store.get(top.id)) screenEl = html`<${MacroEditor} key=${top.triggerId} id=${top.id} tileId=${top.tileId} triggerId=${top.triggerId} nav=${nav} />`;
  else screenEl = html`<${DashList} nav=${nav} />`;

  // iOS home-screen apps can lay the page out a status-bar's height short of the
  // screen, leaving a dead strip at the bottom; when installed and upright, use the full screen.
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const short = standalone && auto.h > auto.w && screen.height > auto.h && screen.height - auto.h < 80;
  const rootStyle = auto.turn
    ? { width: auto.h + "px", height: auto.w + "px", transform: `translate(-50%, -50%) rotate(${-auto.turn}deg)` }
    : short
    ? { bottom: "auto", height: screen.height + "px" }
    : null;

  return html`
    <div class=${"root" + (auto.turn ? " root-turned" : "")} style=${rootStyle}>
      <div class="screen">
        ${screenEl}
        <${Overlays} />
      </div>
    </div>`;
}

store.load().then(() => render(html`<${App} />`, document.getElementById("app")));

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW registration failed", e));
}
