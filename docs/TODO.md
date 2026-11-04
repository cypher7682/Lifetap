# TODO

Things we've talked about but not built yet. Newest ideas at the top of each section.

## Tables

- [ ] **Triggers on table life / counter changes.** For example, "whenever an opponent loses life" or "whenever I get a poison counter", running steps on the dash.
  - Questions to settle: whose changes count (this phone's only, or anyone's at the table), "per point" vs once, and loop protection when a trigger changes the table again (MAX_TRIGGER_RUNS covers the dash side, but table changes arrive from the server later).
- [ ] **Read table values in steps**, e.g. `$x = #life#me` or `#Poison#opponents` as a value source. Today table refs are targets only.
- [ ] **QR code** in the Share sheet, encoding a join link (`?join=<code>`) that opens Join table pre-filled.
- [ ] **Joiner's seat picker in the table layout**, not just a list, so people can find their seat by position.
- [ ] **Long `#…` targets are cut short** in the step editor's dropdown (e.g. `#life#oppo…`).

## Dashes

- [ ] **Default new triggers to "once per point"?**
- [ ] **MAX_TRIGGER_RUNS (500) can trip on big legitimate per-point changes** (e.g. −300 on a per-point trigger) and show "Forced draw?" when it isn't a loop.
- [ ] **iPad / big screens:** a grid cap that scales with the screen, and a real wide landscape layout instead of the turned phone layout. Maybe a "real landscape" option on phones too.

## Shipping

- [ ] **Push Lifetap to GitHub (`main` → Pages)** when happy. Everything since the tables work started lives on the local `tables` branch, tailnet only.
  - The table server goes public via Tailscale Funnel (chart side done). Waiting on the funnel nodeAttr in the tailnet policy, then check from outside the tailnet. `public/js/config.js` already points at that hostname.
- [ ] Add a `helm lint` / template check for `charts/lifetap` once helm is on the box.
