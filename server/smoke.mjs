// End-to-end check against a running server: node server/smoke.mjs http://localhost:8790
import assert from "node:assert/strict";
import * as T from "../public/js/table.js";
const API = process.argv[2] || "http://localhost:8790";
const post = async (path, body) => { const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return [r.status, await r.json()]; };
const get = async (path) => { const r = await fetch(API + path); return [r.status, await r.json()]; };

function stream(id, token) {
  const msgs = [];
  const ac = new AbortController();
  (async () => {
    const r = await fetch(`${API}/api/tables/${id}/stream?token=${token}`, { signal: ac.signal });
    const rd = r.body.getReader(); let buf = "";
    for (;;) { const { value, done } = await rd.read(); if (done) break; buf += new TextDecoder().decode(value);
      let i; while ((i = buf.indexOf("\n\n")) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const d = chunk.split("\n").find((l) => l.startsWith("data: ")); if (d) msgs.push(JSON.parse(d.slice(6))); } }
  })().catch(() => {});
  return { msgs, close: () => ac.abort() };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let [st, made] = await post("/api/tables", { names: ["Tim", "", "Sam"], startLife: 30, device: "devA" });
assert.equal(st, 200);
const id = made.table.id, owner = made.token;
assert.match(made.table.code, /^[a-z0-9]{4}$/);
assert.equal(T.state(made.table).seats[1].name, "Player 2");
console.log("created", made.table.code);
const sA = stream(id, owner);
await wait(200);
assert.equal(sA.msgs[0].type, "snapshot");

// join: bad code, then real code; owner seats them as Player 2
assert.equal((await post("/api/join", { code: "zzzz", name: "x" }))[0], 404);
let [, look] = await post("/api/lookup", { code: made.table.code });
assert.deepEqual(look.seats.map((p) => p.name), ["Player 2", "Sam"], "only unclaimed seats, owner's excluded");
assert.equal(look.seats[0].life, undefined, "no life totals before you're let in");
let [, jr] = await post("/api/join", { code: made.table.code, name: "Dave", device: "devB", seat: look.seats[0].id });
await wait(150);
const reqMsg = sA.msgs.at(-1);
assert.deepEqual(reqMsg.requests.map((r) => [r.name, r.seatName]), [["Dave", "Player 2"]]);
assert.equal((await get(`/api/join/${jr.reqId}`))[1].status, "pending");
const seat = T.state(made.table).seats[1].id;
assert.equal((await post(`/api/tables/${id}/requests/${jr.reqId}`, { token: "nope", approve: true }))[0], 403);
assert.equal((await post(`/api/tables/${id}/requests/${jr.reqId}`, { token: owner, approve: true, seat }))[0], 200);
let [, ans] = await get(`/api/join/${jr.reqId}`);
// a second joiner asking for the same seat gets told it's gone when the owner tries it
let [, jr2] = await post("/api/join", { code: made.table.code, name: "Eve", device: "devC", seat });
assert.equal((await post(`/api/tables/${id}/requests/${jr2.reqId}`, { token: owner, approve: true, seat }))[0], 409);
assert.deepEqual((await post("/api/lookup", { code: made.table.code }))[1].seats.map((p) => p.name), ["Sam"]);
assert.equal(ans.status, "approved"); assert.equal(ans.me, seat);
const dave = ans.token;
const sB = stream(id, dave);
await wait(200);
assert.equal(T.state(sB.msgs[0].table).byId[seat].name, "Dave");

// acts: Dave's taps bundle, Tim's don't merge with Dave's; reply carries the change
let [, r1] = await post(`/api/tables/${id}/act`, { token: dave, cid: "c1", ops: [{ op: "life", p: seat, d: -1 }] });
let [, r2] = await post(`/api/tables/${id}/act`, { token: dave, cid: "c2", ops: [{ op: "life", p: seat, d: -2 }] });
assert.equal(r2.from, r1.from, "second tap amends the same event");
assert.equal(r2.events[0].ops[0].d, -3);
await post(`/api/tables/${id}/act`, { token: owner, cid: "c3", ops: [{ op: "cmdr", to: seat, from: made.me, part: 0, d: 4 }] });
await wait(150);
// rebuild from what the stream sent
const evs = [...sA.msgs[0].table.events];
for (const m of sA.msgs.slice(1)) if (m.type === "update" && m.from != null) { const keep = evs.filter((e) => e.seq < m.from); evs.length = 0; evs.push(...keep, ...m.events); }
const tbl = { ...sA.msgs[0].table, events: evs };
assert.equal(T.state(tbl).byId[seat].life, 30 - 3 - 4);
assert.ok(sA.msgs.some((m) => m.cids && m.cids.includes("c3")));
// undo from Dave's phone takes back Tim's commander damage (last action at the table)
let [, u] = await post(`/api/tables/${id}/act`, { token: dave, cid: "c4", kind: "undo" });
const snap = (await get(`/api/tables/${id}?token=${dave}`))[1];
assert.equal(T.state(snap.table).byId[seat].life, 27);
console.log("acts, bundles, undo ok");

// owner leaves: Dave becomes owner and is told
await post(`/api/tables/${id}/leave`, { token: owner });
await wait(150);
const lastB = sB.msgs.at(-1);
assert.equal(lastB.owner, seat); assert.equal(lastB.newOwner, seat);
assert.equal((await get(`/api/tables/${id}?token=${owner}`))[0], 403);
console.log("owner handoff ok");

// join rate limit per IP
let limited = false;
for (let i = 0; i < 12; i++) if ((await post("/api/join", { code: "qqqq" }))[0] === 429) limited = true;
assert.ok(limited);
console.log("rate limit ok");
sA.close(); sB.close();
console.log("ALL OK");
process.exit(0);
