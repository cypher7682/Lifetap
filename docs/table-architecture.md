# Lifetap tables — architecture

Status: **phases 1–3 built.** Phase 1 is the table screen on one phone. Phase 3 is the table server, running as a k8s pod on the tailnet only. Phase 4 is design only.
Anything in the UI that depends on an unbuilt phase is a stub (`void`) that says so.

## Goals

- A shared life-total table for a game (Commander first): start a table, others join with a short code,
  everyone sees and can change the same life totals, commander damage, monarch and deaths.
- Every change is recorded. The whole table can be undone from any device and rebuilt from its history.
- Lightweight: one small server, no accounts, tables die after 60 minutes idle.
- Each player keeps their own counters dash and flips between it and the table (heart / ++ switch).

Non-goals: anti-cheat voting or quorum (it's a kitchen table; ordering + undo is enough), peer-to-peer.

## Decisions log

| # | Decision | Why |
|---|----------|-----|
| 1 | **Client–server, not peer-to-peer.** The server keeps the record of each table. | WebRTC still needs a signalling server, and on mobile data often needs a relay (TURN) too. A server is simpler and also gives us history, TTL and rebuilds for free. |
| 2 | **Event-sourced table.** State = replay of an append-only event log. | "Reversible from everywhere", rebuildable, and the same code runs on phone and server. |
| 3 | **Undo/redo are events too** (`undo #57`), not deletions. | History only grows; every device converges on the same log. |
| 4 | **Server orders events** (assigns `seq`). No voting. | Resolves simultaneous taps deterministically. Mistakes are fixed by undo, visible to all. |
| 5 | **4-second bundles.** Consecutive life / commander-damage taps by the same device within 4s of its previous tap merge into one event. | One undo takes back "Tim −7", not seven taps. Same window as the dash delta badges (was 5.3s, now 4s). |
| 6 | **Table codes are 4 chars `[a-z0-9]`** (36⁴ = 1,679,616). | Short to read out; owner approval does the real gatekeeping. |
| 7 | **Joining needs owner approval.** | A guessed code gets you a "Deny" at best. A separate PIN adds little. |
| 8 | **Owner hands off on leave.** Crown shown on the owner in the table info row. | The table outlives whoever started it. |
| 9 | **TTL: 60 minutes with no events clears the table** (server deletes it; phones drop it too). | Requested. |
| 10 | **Player cap 16.** The 17th gets "Are you taking the piss?" with one button: "Yes". | Requested, verbatim. |
| 11 | **Partner split is a property of the source player** (their commander is split into I and II for every opponent). | Partners belong to the player who has them, so splitting on one victim's view splits it everywhere. |
| 12 | **Commander damage also changes life** (inside the same op, so undo restores both). Commander damage can't go below 0. | Requested; keeps both totals consistent. |
| 13 | **Nobody dies automatically.** The skull button kills or revives a player. Life can go to −300. | Requested. |
| 14 | **Removed players stay in the record** (flagged), so history keeps their names. | Rebuildable history. |

## Data model

```
Table {
  id, code,                 // code: 4 × [a-z0-9]
  createdAt, updatedAt,     // updatedAt = time of last event (drives TTL)
  owner: playerId,          // the crown (phase 3: handed off on leave)
  me: playerId | null,      // which seat this device is (local only)
  myDash: dashId | null,    // which counters dash ++ opens (local only)
  events: Event[],
}

Event {
  seq,                      // 1, 2, 3… (server-assigned in phase 3)
  t, tEnd,                  // first and last touch (ms); tEnd moves while a bundle is open
  by,                       // device id (localStorage "lifetap:device")
  kind: "start" | "action" | "undo" | "redo",
  ops: Op[],                // for action/start
  target: seq,              // for undo/redo
}

Op =
  { op: "add",      p: {id, name, color} }
  { op: "remove",   p }
  { op: "rename",   p, name, was }
  { op: "life",     p, d }
  { op: "cmdr",     to, from, part: 0|1, d }      // also life −= applied d
  { op: "partners", p, on }
  { op: "dead",     p, on }
  { op: "monarch",  p | null, was }
  { op: "reset" }                                 // life → start, commander damage cleared, all alive, no monarch
  { op: "settings", startLife }
```

### Replay

1. Walk events in `seq` order, keeping a `done` stack and an `undone` stack.
   An action pushes onto `done` and clears `undone`. `undo #n` moves n from `done` to `undone`. `redo #n` moves it back.
2. Fold the ops of every event in `done`, in `seq` order, over an empty table.
   Ops that mention a player who doesn't exist (e.g. their `add` was undone) are skipped.

Pure functions in `public/js/table.js`; tests in `tests/table.test.mjs`. The server will import the same file.

### Bundling (decision 5)

When a device submits a life/cmdr action and the **last event in the log** is
its own, also life/cmdr only, not undone, and `now − tEnd ≤ 4000`:
merge the ops (sum `d` per player / per commander part), drop zeros, update `tEnd`.
If everything nets to zero the event is removed. Phase 3: the client sends
`amend #seq` instead of a new event; the server accepts it only under the same rule,
otherwise it treats it as a new event.

## Phase 3 server (built)

What actually shipped, where it differs from the design below:
- **Transport:** plain HTTP POST for actions plus **Server-Sent Events** for live updates, instead of a WebSocket. No dependencies (`server/server.mjs` uses node:http and node:sqlite, and imports `public/js/table.js`).
- **Deploy:** Argo CD, from `cypher7682/cluster-control` → `charts/lifetap` (namespace `lifetap`, 1Gi local-path PVC, node:24-alpine running the code from a ConfigMap built from the chart's `files/`). The ingress is the `lifetap-api` entry in `charts/tailscale/values.yaml`, giving https://lifetap-api.tail63e765.ts.net. To ship server changes, run `scripts/sync-cluster-control.sh <checkout>`, then commit and push cluster-control.
- **Public access:** Tailscale Funnel on the same hostname (`funnel: true` for `lifetap-api` in `charts/tailscale/values.yaml`). It needs the `funnel` nodeAttr for the operator's proxies in the tailnet policy.
- **Pod hardening:**
  - Non-root (uid 1000), read-only root filesystem, all capabilities dropped, RuntimeDefault seccomp, no service account token.
  - NetworkPolicy: traffic in only from its Tailscale proxy pod, **no traffic out at all** (verified: internet, LAN and cluster API all time out).
  - Rate limits key on the last `X-Forwarded-For` entry, the one the proxy adds.
- **Bundling** happens on the server. Clients send raw ops, and the server merges them using the member's device id.
- **Clients** apply their own actions straight away and replay any still-unacknowledged actions on top of the server's log (`public/js/sync.js`).
- **Joining:** the owner seats a joiner as a new player or as an unclaimed seat (renamed to the joiner's name).
- **Check:** `node server/smoke.mjs <api url>` exercises create / join / approve / act / bundle / undo / owner handoff / rate limit.

## Phase 3 server (original design)

- **Stack:** one small Node process (no framework), `node:sqlite` / better-sqlite3, WebSocket (`ws`).
  Serves only the API; the app stays on GitHub Pages / tailnet.
- **Hosting is open:** phones off the tailnet need a public HTTPS/WSS address
  (Tailscale Funnel on the existing box, or a small VPS). Pages is HTTPS, so it must be `wss://`.
- **SQLite tables:**
  - `tables(id, code UNIQUE, owner, created_at, updated_at, settings_json)`
  - `events(table_id, seq, t, t_end, by, kind, payload_json, PRIMARY KEY(table_id, seq))`
  - `members(table_id, player_id, device_id, token_hash, name, joined_at)`
  - `requests(table_id, req_id, device_id, name, created_at, status)`
- **Protocol (JSON over one WebSocket):**
  - `create {name, settings}` → `{table, code, token}`
  - `join {code, name}` → owner gets `joinRequest {reqId, name}`; owner sends `approve|deny {reqId}`;
    requester gets `{token, events}` or `denied`.
  - `hello {tableId, token, since}` → resync, sending events after `since`.
  - `submit {op…}` / `amend {seq, ops}` / `undo` / `redo` → server appends, broadcasts `event`.
  - `leave` → if owner, ownership passes to the longest-joined connected member, who gets a `youAreOwner` notice.
- **Security:**
  - Codes are random from a CSPRNG and released when the table dies.
  - Joining needs owner approval, and the token (random 128-bit, stored hashed) is required for every later message.
  - Join attempts are rate-limited per IP and per code, e.g. 10/min per IP and 30/min per code, with backoff.
  - Requests are capped in size, and there's a per-connection message rate limit.
- **TTL:** a sweep every minute deletes tables whose `updated_at` is more than 60 minutes ago (events, members, requests cascade). Clients see `gone` and drop the table.
- **Offline:** clients queue submits while disconnected and send them on reconnect. The server orders them on arrival.

## Phase 4: table steps in macros (built)

- **Target:** `#life#<who>`, with + and − only. Who is one of: `#opponents`, `#opponentRandom`, `#playerRandom`, `#me`, `#all`, or `#<playerName>`.
  - Only living players count, except a named player, who is hit even if dead.
  - Random targets are re-rolled each time the step runs, so ×30 means 30 rolls.
  - A random step can also be **per point** (`perPoint: true`): every point of its value is rolled separately. **Total** (the default for steps) sends the whole value to one pick. The tile pane has a Per point / Total toggle under the random rows (remembered per device), and recordings keep it.
- **One action, one table event:** a tap, macro or toggle (repeats and triggers included) nets its life changes per player and sends them to the table as one action. The dash event keeps those ops, so **dash undo sends the reverse** as a new table action instead of using the table's undo (which might belong to someone else). Redo sends them again.
- **No table:** table steps are skipped with a note, and the rest of the macro runs. A missing named player is reported.
- **Damage tile:**
  - It's a sheet of signed life changes: Random opponent and Random player rows (−10 −1 +1 +10), then each seat (− / + beside the number, ±10 and ±100 below).
  - Done runs them as `#life` steps.
  - While recording, it adds those steps to the macro: seats are recorded by name, and your own seat as `#me`.
- **Repeat:** hold any macro and pick Repeat… to set a count. The macro's "Repeat by default" setting makes a tap ask for one.
- **No end-of-action damage pool** (decided against).
- **Player counters:** `{op: "counter", p, name, d}`.
  - Names are matched case-insensitively and counts never go below 0. They bundle like life, and reset clears them. They show on table cards, bottom left.
  - Macros use `#<name>#<who>`, e.g. `#poison#opponents`.
  - The dash's **Table counter** tile shows a mini table of each player's count and opens the same sheet as Table Life.
  - **No table:** both tiles say "No table". Tapping one offers to start a table there and then: pick how many players, and it's a normal joinable table, with an offline fallback if the server can't be reached. Then the pane opens. This phone can run it for everyone, and others can join later with the code.
- The Damage tile is now called **Table Life**.

## Phase 4 (original design)

- **Damage allocation (B):** when the dash loses life (a counter flagged as "life"), a splash asks
  "Allocate damage to… [name] [name] … [Other (does nothing)]" and submits a `life` op for the chosen player.
- **Table variables in macros:** `#life`, `#cmdr` etc. (read-only refs to your seat).
- **Dead players** drop out of allocation lists.

## UI (phase 1, built)

- **Home:** [Start a table] [Join table] at the bottom. Join is a stub until phase 3.
  When a table is live: "Back to table · code".
- **New table:** your name, other players (optional), table settings (starting life, default 40).
- **Table screen:**
  - **Header:** back, `Table · code` + ⌄ menu, crown + owner name.
  - **Cards:** one per player. `rows = ceil(n / 2)`; an odd last player gets a full-width card.
    Each card faces the screen edge it shares the most length with (ties go to the vertical edge,
    i.e. the long side of the phone), so a phone lying in the middle of the table reads right for everyone.
  - **Card contents:** name, life, − / +, commander-damage button, monarch crown (top right, greyed until claimed).
  - **Rail:** dice, undo (hold: View history / Undo), redo, skull (kill mode), heart / ++ switch.
- **⌄ menu:** Players (add / remove / rename; the 17-player splash), Switch view, Share (code/QR; stub),
  Table settings, Reset table, Leave table (phase 1: closes the local table).
- **Commander damage:** a mini copy of the table for one victim. Each opponent shows I/II (split), with ± on each part.
  The victim's own box is lighter but still adjustable.
- **Hold ±** (life or commander damage): the −10 −1 +1 +10 sheet, turned to face that player.
- **Dice:** coin, d4, d6, d8, d10, d12, d20, with an "Animation" switch remembered per device.
- **Kill mode:** tap the skull and every card shakes as a skull; tap a player to kill (or revive) them, and kill mode ends.
- **History:** full-page, newest first, lazy-loaded 60 at a time; undone events struck through.
- **Heart / ++ switch:** a reusable `ViewSwitch` component. It's in the table rail and on the dash header while a table is live.
  The first ++ asks which dash is yours (list + "New dash").

## Open questions

- Where the phase 3 server is hosted (Funnel vs VPS).
- Should dash-level undo also bundle taps in 4s windows? (Currently only the delta badge uses 4s.)
