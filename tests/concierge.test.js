import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, commit, todayIn, agentCard } from "../lib/gateway.js";
import { seal, unseal, verifyReceipt } from "../lib/sign.js";
import { execute, unref } from "../lib/tools.js";
import { runLoop, applyDecision } from "../lib/agent.js";
import { mockClient } from "../lib/mock-model.js";
import { weather, fx, flight, places } from "../lib/live.js";

const today = todayIn("Asia/Kolkata");
const plus = (d) => new Date(Date.parse(today + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);
const ctx = { currency: "INR", today, principal: "Test", agent_id: "agent://test" };

function freshState(mandate = { cap: 5000, askAbove: 1000 }, extra = {}) {
  return {
    v: 1, created: Date.now(), origin: "http://localhost", city: "mumbai", currency: "INR", today, asked: {},
    firstName: "Sandip", mandate, messages: [{ role: "user", content: `Today is Saturday, ${today}. Errands: dinner, dentist, gym, mom, society` }],
    turns: 0, nudged: false, done: false, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    errands: [], offers: {}, approvals: {}, receiptCount: 0, pending: null, ...extra,
  };
}

const json = async (p) => JSON.parse((await p).content);
const call = (state, ref, biz, intent, params, asked_for) => json(execute("call_gateway", { errand_ref: ref, business_id: biz, intent, params, asked_for }, state, () => {}));
const commitIt = (state, ref, id) => json(execute("commit_offer", { errand_ref: ref, offer_id: id }, state, () => {}));

test("sealed tokens round-trip and reject tampering", () => {
  const token = seal("state", { a: 1, b: [1, 2] }, { gzip: true });
  assert.deepEqual(unseal("state", token), { a: 1, b: [1, 2] });
  assert.equal(unseal("offer", token), null, "label binds the token");
  const flipped = token.slice(0, 5) + (token[5] === "A" ? "B" : "A") + token.slice(6);
  assert.equal(unseal("state", flipped), null);
});

test("gateway search, hold and commit produce a verifiable receipt", () => {
  const search = handle("saffron-room", "availability.search", { date: plus(3), time: "20:00", party_size: 4 }, ctx);
  assert.ok(search.ok && search.slots.length > 0);
  const hold = handle("saffron-room", "table.hold", { slot_id: search.slots[0].slot_id, party_size: 4, guest_first_name: "Sandip" }, ctx);
  assert.equal(hold.offer.amount, 2000);
  const done = commit(hold.offer_token, ctx);
  assert.ok(done.ok);
  assert.equal(verifyReceipt(done.receipt), true);
  assert.equal(verifyReceipt({ ...done.receipt, amount: 1 }), false, "altered receipt fails");
});

test("gateway refuses identifiers but accepts its own slot ids", () => {
  const leak = handle("fixit-home", "visit.hold", { slot_id: "FX-PLU-20261010-1000", customer_first_name: "A", issue_summary: "Aadhaar 1234 5678 9012" }, ctx);
  assert.equal(leak.error.code, "SENSITIVE_DATA_REJECTED");
  const search = handle("fixit-home", "visit.search", { service: "plumbing", date_from: plus(1) }, ctx);
  const hold = handle("fixit-home", "visit.hold", { slot_id: search.slots[0].slot_id, customer_first_name: "A", issue_summary: "Leaking kitchen tap" }, ctx);
  assert.ok(hold.ok, JSON.stringify(hold));
});

test("gateway rejects past dates and unknown intents", () => {
  assert.equal(handle("citycare-clinic", "slots.search", { specialty: "gp", date_from: "2020-01-01" }, ctx).error.code, "BAD_DATE");
  assert.equal(handle("citycare-clinic", "table.hold", {}, ctx).error.code, "UNSUPPORTED_INTENT");
  assert.ok(agentCard("citycare-clinic", "https://x").receipts.public_jwk.x);
});

test("mandate: over-cap and unapproved commits are refused in code", async () => {
  const state = freshState({ cap: 1500, askAbove: 500 });
  const emit = () => {};
  const search = JSON.parse((await execute("call_gateway", { errand_ref: "E1", business_id: "saffron-room", intent: "availability.search", params: { date: plus(2), time: "19:30", party_size: 4 } }, state, emit)).content);
  const held = JSON.parse((await execute("call_gateway", { errand_ref: "E1", business_id: "saffron-room", intent: "table.hold", params: { slot_id: search.slots[0].slot_id, party_size: 4 } }, state, emit)).content);
  const over = await execute("commit_offer", { errand_ref: "E1", offer_id: held.offer.offer_id }, state, emit);
  assert.equal(JSON.parse(over.content).error, "MANDATE_CAP_EXCEEDED"); // ₹2,000 > ₹1,500 cap

  const state2 = freshState({ cap: 5000, askAbove: 500 });
  const held2 = JSON.parse((await execute("call_gateway", { errand_ref: "E1", business_id: "saffron-room", intent: "table.hold", params: { slot_id: search.slots[0].slot_id, party_size: 2 } }, state2, emit)).content);
  assert.equal(JSON.parse((await execute("commit_offer", { errand_ref: "E1", offer_id: held2.offer.offer_id }, state2, emit)).content).error, "APPROVAL_REQUIRED");
  const pause = await execute("request_approval", { errand_ref: "E1", offer_id: held2.offer.offer_id, question: "OK?" }, state2, emit);
  assert.ok(pause.pause);
  state2.approvals[held2.offer.offer_id] = true;
  assert.equal(JSON.parse((await execute("commit_offer", { errand_ref: "E1", offer_id: held2.offer.offer_id }, state2, emit)).content).status, "confirmed");
});

test("a full run pauses for approval, survives sealing, and finishes", async () => {
  const events = [];
  const emit = (e) => events.push(e);
  let state = freshState();
  let outcome = await runLoop(state, emit, { client: mockClient });
  let guard = 0;
  while (outcome === "paused" && guard++ < 5) {
    assert.equal(events.filter((e) => e.t === "plan").length, 0);
    state = unseal("state", seal("state", state, { gzip: true }));
    applyDecision(state, "approve", emit);
    outcome = await runLoop(state, emit, { client: mockClient });
  }
  assert.equal(outcome, "done");
  const plan = events.find((e) => e.t === "plan").plan;
  assert.equal(plan.errands.length, 4);
  assert.equal(events.filter((e) => e.t === "receipt").length, 2, "dinner and plumber confirmed");
  assert.ok(events.some((e) => e.t === "live" && e.kind === "weather"), "weather fetched");
  assert.ok(events.some((e) => e.t === "live" && e.kind === "places" && e.places.length), "real places found");
  assert.ok(events.some((e) => e.t === "ledger" && e.title === "Approved by you"));
  assert.ok(events.some((e) => e.t === "calendar") && events.some((e) => e.t === "draft"));
  // Append-only history: every tool_use is answered by a tool_result in the next user message.
  for (let i = 0; i < state.messages.length - 1; i++) {
    const m = state.messages[i];
    if (m.role !== "assistant") continue;
    const ids = m.content.filter((b) => b.type === "tool_use").map((b) => b.id);
    const answered = (state.messages[i + 1]?.content || []).filter((b) => b.type === "tool_result").map((b) => b.tool_use_id);
    for (const id of ids) assert.ok(answered.includes(id), `tool_use ${id} answered`);
  }
});

test("declining an approval leaves the errand uncommitted", async () => {
  const events = [];
  const emit = (e) => events.push(e);
  const state = freshState();
  let outcome = await runLoop(state, emit, { client: mockClient });
  let guard = 0;
  while (outcome === "paused" && guard++ < 5) {
    applyDecision(state, "decline", emit);
    outcome = await runLoop(state, emit, { client: mockClient });
  }
  assert.equal(outcome, "done");
  const dinner = events.find((e) => e.t === "plan").plan.errands.find((e) => e.ref === "E2");
  assert.equal(dinner.status, "skipped");
  const offers = Object.fromEntries(events.filter((e) => e.t === "offer").map((e) => [e.offer.offer_id, e.offer]));
  const receipts = events.filter((e) => e.t === "receipt");
  assert.ok(receipts.length <= 1, "at most the plumber visit");
  for (const r of receipts) {
    const o = offers[r.receipt.offer_id];
    assert.ok(!o.differs_from_request && o.amount < state.mandate.askAbove, "only an offer that needed no approval was committed");
  }
});

test("mandate: the ask-me line is inclusive", async () => {
  const state = freshState({ cap: 600, askAbove: 200 }, { city: "dubai", currency: "AED" });
  const dubai = { ...ctx, currency: "AED" };
  const search = handle("saffron-room", "availability.search", { date: plus(3), time: "21:00", party_size: 2 }, dubai);
  const at = search.slots.find((x) => x.time === "21:00") ?? search.slots[0];
  const held = await call(state, "E1", "saffron-room", "table.hold", { slot_id: at.slot_id, party_size: 2 });
  assert.equal(held.offer.amount, 200);
  assert.match(held.approval, /^required before commit/);
  assert.equal((await commitIt(state, "E1", held.offer.offer_id)).error, "APPROVAL_REQUIRED", "AED 200 with an AED 200 line asks");
  const cheap = freshState({ cap: 600, askAbove: 201 }, { city: "dubai", currency: "AED" });
  const held2 = await call(cheap, "E1", "saffron-room", "table.hold", { slot_id: at.slot_id, party_size: 2 });
  assert.equal((await commitIt(cheap, "E1", held2.offer.offer_id)).status, "confirmed", "below the line commits");
});

test("mandate: an offer other than what the visitor asked for needs approval, however cheap", async () => {
  const state = freshState({ cap: 5000, askAbove: 5000 });
  const search = await call(state, "E1", "saffron-room", "availability.search", { date: plus(3), time: "21:00", party_size: 2 }, { date: plus(3), time: "21:00" });
  const other = search.slots.find((x) => x.time !== "21:00");
  // The agent can't move the goalposts by searching again with the time it found.
  await call(state, "E1", "saffron-room", "availability.search", { date: plus(3), time: other.time, party_size: 2 }, { date: plus(3), time: other.time });
  const held = await call(state, "E1", "saffron-room", "table.hold", { slot_id: other.slot_id, party_size: 2 });
  assert.deepEqual(held.offer.differs_from_request, { asked: `${new Date(plus(3) + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}, 21:00`, offered: held.offer.differs_from_request.offered });
  assert.match(held.approval, /isn't what you asked for/);
  assert.equal((await commitIt(state, "E1", held.offer.offer_id)).error, "APPROVAL_REQUIRED");
  const pause = await execute("request_approval", { errand_ref: "E1", offer_id: held.offer.offer_id, question: "No table at 21:00 for E1. OK?" }, state, () => {});
  assert.deepEqual(pause.pause.why, ["it isn't what you asked for"]);

  const exact = search.slots.find((x) => x.time === "21:00");
  if (exact) {
    const fine = await call(state, "E1", "saffron-room", "table.hold", { slot_id: exact.slot_id, party_size: 2 });
    assert.equal((await commitIt(state, "E1", fine.offer.offer_id)).status, "confirmed", "the slot they asked for commits");
  }
});

test("mandate: without asked_for, a table search's own time stands in; a part of day is checked", async () => {
  const state = freshState({ cap: 5000, askAbove: 5000 });
  const search = await call(state, "E1", "saffron-room", "availability.search", { date: plus(3), time: "21:00", party_size: 2 });
  const other = search.slots.find((x) => x.time !== "21:00");
  const held = await call(state, "E1", "saffron-room", "table.hold", { slot_id: other.slot_id, party_size: 2 });
  assert.ok(held.offer.differs_from_request);

  const visits = await call(state, "E2", "fixit-home", "visit.search", { service: "plumbing", date_from: plus(2), part_of_day: "morning" }, { part_of_day: "morning" });
  for (const v of visits.slots) {
    const h = await call(state, "E2", "fixit-home", "visit.hold", { slot_id: v.slot_id, customer_first_name: "A", issue_summary: "Tap" });
    assert.equal(Boolean(h.offer.differs_from_request), v.time >= "12:00", `${v.date} ${v.time}`);
  }
});

test("errand refs never reach the visitor", async () => {
  const state = freshState();
  state.errands = [{ ref: "E3", title: "Table for 2 on Friday 9pm" }, { ref: "E1", title: "Weather" }];
  assert.equal(unref("The demo Saffron Room is booked for E3 and marked vegetarian.", state), "The demo Saffron Room is booked for “Table for 2 on Friday 9pm” and marked vegetarian.");
  assert.equal(unref("Booked for Friday (E3).", state), "Booked for Friday.");
  assert.equal(unref("See errands E1 and E3 (E1, E3).", state), "See errands “Weather” and “Table for 2 on Friday 9pm”.");
  assert.equal(unref("Terminal E7 is unaffected", state), "Terminal E7 is unaffected", "only known refs are touched");
  const events = [];
  await execute("finish", { headline: "Done (E3).", errands: [{ ref: "E3", status: "done", outcome: "Booked E3." }] }, state, (e) => events.push(e));
  assert.equal(events[0].plan.headline, "Done.");
  assert.equal(events[0].plan.errands[0].outcome, "Booked “Table for 2 on Friday 9pm”.");
  assert.equal(events[0].plan.errands[0].ref, "E3", "the ref itself stays for the page to match cards");
});

test("the Dubai script asks before booking a different time, and finishes without refs", async () => {
  for (const decision of ["approve", "decline"]) {
    const events = [];
    const emit = (e) => events.push(e);
    const state = freshState({ cap: 600, askAbove: 1000 }, { city: "dubai", currency: "AED" });
    state.messages = [{ role: "user", content: `Today is Saturday, ${today}.\n<errands>\nWeekend in Dubai: book a table for 2 on Friday 9pm\n</errands>` }];
    let outcome = await runLoop(state, emit, { client: mockClient });
    assert.equal(outcome, "paused", "the cheap but different slot comes back to the visitor");
    assert.ok(!/\bE\d\b/.test(state.pending.question), state.pending.question);
    applyDecision(state, decision, emit);
    outcome = await runLoop(state, emit, { client: mockClient });
    assert.equal(outcome, "done");
    assert.equal(events.filter((e) => e.t === "receipt").length, decision === "approve" ? 1 : 0);
    const plan = events.find((e) => e.t === "plan").plan;
    assert.ok(!/\bE\d\b/.test(JSON.stringify([plan.headline, plan.errands.map((e) => [e.outcome, e.your_next_step])])), JSON.stringify(plan));
  }
});

test("live tools: weather, places, fx parse real response shapes; flight needs a key", async () => {
  const w = await weather({ place: "Delhi", date_from: plus(3) }, { today });
  assert.equal(w.days[0].summary, "showers");
  assert.equal(w.days[0].max_c, 29.3);
  assert.match((await weather({ place: "Delhi", date_from: plus(30) }, { today })).error, /16 days/);
  const p = await places({ what: "restaurant", area: "Bandra West" }, { cityLabel: "Mumbai", currency: "INR" });
  assert.equal(p.places[1].phone, "022 3296 9618");
  assert.match(p.places[0].map, /openstreetmap\.org\/node\//);
  const r = await fx({ amount: 500, from: "AED", to: "INR" });
  assert.ok(r.error || r.converted > 0);
  delete process.env.AERODATABOX_KEY;
  assert.equal((await flight({ flight_number: "AI2631" }, { today })).error, "NOT_CONNECTED");
  process.env.AERODATABOX_KEY = "test";
  const f = await flight({ flight_number: "AI 2631", date: plus(5) }, { today }, async () => true);
  assert.equal(f.status, "Expected");
  assert.equal(f.departure.terminal, "2");
  assert.equal((await flight({ flight_number: "AI2631" }, { today }, async () => false)).error, "QUOTA");
  delete process.env.AERODATABOX_KEY;
});
