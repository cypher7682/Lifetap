# Lifetap

A phone-first PWA for tracking lots of interacting counters during a game. Each **dash** is a grid of +/− counter tiles plus a bar of **macros**. A macro applies several steps in one tap.

No build step and no dependencies at runtime: plain ES modules plus a vendored copy of Preact + htm (`public/vendor/preact-htm.js`) and the Inter font (`public/fonts`, OFL). Everything is stored locally in IndexedDB. It works offline once the service worker has cached it.

## Layout

```
public/            the app (served as-is in dev)
  js/engine.js     pure data logic: macros, undo/redo log, grid ops (unit-tested)
  js/store.js      IndexedDB persistence
  js/ui.js         long-press, sheets, popovers, dialogs, snackbar
  js/screens/      list, new dash, dash (play / record / edit), macro step editor
  sw.js            app-shell service worker (stamped by scripts/build.py)
scripts/build.py   copy public/ → dist/, stamp sw.js with a content hash + precache list
scripts/deploy.sh  build + `tailscale serve` at https://<host>.ts.net/counter-dash/
tests/             node --test unit tests for the engine
```

## Dev

```sh
npm test                 # engine unit tests (Node 20+)
npm run serve            # http://localhost:8123 (SW works on localhost)
./scripts/deploy.sh      # build and publish on the tailnet
```

Pushing to `main` on GitHub runs `.github/workflows/pages.yml`: tests, build, then publish to GitHub Pages (https://cypher7682.github.io/Lifetap/).

After a deploy, an installed copy picks up the new version the next time it's opened (it may take a second launch on iOS).

## Notes on spec decisions

- Undo history keeps 10,000 events per dash (effectively unlimited). Reset / New game clears it, as specified.
- Delta badges also appear when a macro changes a tile, not only on +/− taps, so you can see what a macro did.
- Added a 3×4 layout (up to 12 counters; best fit for 10–12). 3-column grids use 8px gaps so −/+ stay ≥ 44px at 360px wide.
- In edit mode, hold a tile and drag it to another cell (moves into empties, swaps with occupied). Macros can be dragged between the grid and the macro bar; counters/boxes can't go on the bar.
- Reset / New game lives in the menu under the dash title (marked with ▾).
- Horizontal view: automatic when the OS rotates to landscape on a touch device; manual setting in edit mode for rotation-locked phones.
- Re-recording an existing macro asks for confirmation first, then replaces its steps when you tap Stop.
- Tiles have an "Allow negative" setting (off by default). Any tap, take or macro step that would take a non-negative tile below 0 rejects the whole action with a splash; checked per step, so step order matters.
- Dash variables (`@name`) belong to the whole dash and keep their value between macro runs (macro `$vars` reset every run). Reset / New game returns them to their starting value.
- Toggle boxes hold one or two on/off switches; macros read them as 1/0 and setting one to anything non-zero turns it on. Recording captures a flipped switch as an `=` step.
- Vars boxes show up to 4 dash variables. Display only; macros change the values.
- Counter triggers ("when it goes down / up / changes") run a step list with a built-in `$change` (or once per point). They fire immediately, mid-step, depth-first, so a macro's later steps see their effects. A trigger that would take a no-negatives tile below 0 is rolled back on its own; the action carries on. More than 500 trigger runs in one action = "Forced draw?" splash and nothing changes. A tap or macro plus all its triggers is one undo. Recordings only capture direct taps.
- Steps whose tile or variable has been removed are shown in red and skipped at run time, with a one-line warning.
