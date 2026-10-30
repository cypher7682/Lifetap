# Counter Dash

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

After a deploy, an installed copy picks up the new version the next time it's opened (it may take a second launch on iOS).

## Notes on spec decisions

- Undo history keeps 10,000 events per dash (effectively unlimited). Reset / New game clears it, as specified.
- Delta badges also appear when a macro changes a tile, not only on +/− taps, so you can see what a macro did.
- Horizontal view: automatic when the OS rotates to landscape on a touch device; manual setting in edit mode for rotation-locked phones.
- Re-recording an existing macro asks for confirmation first, then replaces its steps when you tap Stop.
- Tiles have an "Allow negative" setting (off by default). Any tap, take or macro step that would take a non-negative tile below 0 rejects the whole action with a splash; checked per step, so step order matters.
- Steps whose tile or variable has been removed are shown in red and skipped at run time, with a one-line warning.
