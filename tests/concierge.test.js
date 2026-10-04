import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, commit, todayIn, agentCard } from "../lib/gateway.js";
import { seal, unseal, verifyReceipt } from "../lib/sign.js";
import { execute, unref, calendarWording } from "../lib/tools.js";
import { runLoop, applyDecision } from "../lib/agent.js";
import { mockClient } from "../lib/mock-model.js";
import { weather, fx, flight, places, parsePlaceQuery, setFetch } from "../lib/live.js";
import { fakeFetch } from "../lib/mock-live.js";

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
  assert.ok(p.places.some((x) => x.phone === "022 3296 9618"));
  assert.match(p.places[0].map, /openstreetmap\.org\/node\//);
  assert.equal(p.summary, "2 restaurants near Bandra West");
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

test("places: plain words become fixed OSM tag filters", () => {
  const veg = parsePlaceQuery("Vegetarian restaurant");
  assert.equal(veg.label, "vegetarian restaurant");
  assert.equal(veg.narrow.length, 1);
  assert.equal(parsePlaceQuery("pure veg south indian food").label, "vegetarian south indian restaurant");
  assert.equal(parsePlaceQuery("plumber").relatedLabel, "hardware and plumbing shop");
  assert.equal(parsePlaceQuery("dentist").label, "dentist");
  assert.equal(parsePlaceQuery("vegetarian dentist").narrow.length, 0, "diet narrows food places only");
  assert.equal(parsePlaceQuery("something odd"), null);
});

test("places: vegetarian is filtered by tag, plumbers fall back to labelled shops, and visitor text never reaches Overpass", async () => {
  const bodies = [];
  setFetch((url, opts) => { if (/overpass/.test(url)) bodies.push(decodeURIComponent(String(opts.body))); return fakeFetch(url, opts); });
  try {
    const veg = await places({ what: "vegetarian restaurant\"];out;(", area: "Bandra West" }, { cityLabel: "Mumbai", currency: "INR" });
    assert.deepEqual(veg.places.map((x) => x.name).sort(), ["Balaji Restaurant", "Love in Langos"]);
    assert.match(veg.places.find((x) => x.name === "Love in Langos").kind, /pure vegetarian/);
    assert.ok(veg.places.every((x) => typeof x.distance_km === "number"));
    const plumber = await places({ what: "plumber" }, { cityLabel: "Mumbai", currency: "INR" });
    assert.equal(plumber.related, true);
    assert.match(plumber.summary, /^No plumbers listed; 2 hardware and plumbing shops nearby$/);
    assert.match(plumber.for_agent, /not plumbers/);
    assert.equal(plumber.places.find((x) => x.name === "Public Stores").phone, "+91 90299 11436", "one number per Call button");
    assert.ok(bodies.length >= 2);
    for (const b of bodies) {
      assert.ok(!/around:/.test(b), "bounding boxes, not around");
      assert.ok(!/vegetarian restaurant|\];out;\(|plumber"\]/i.test(b.replace(/"craft"="plumber"/, "")), "no visitor text in the query: " + b);
    }
  } finally {
    setFetch(fakeFetch);
  }
});

test("places: an Overpass timeout is 'couldn't check', not 'none listed'", async () => {
  setFetch((url, opts) => (/overpass/.test(url)
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ elements: [], remark: "runtime error: Query timed out in \"query\" at line 1 after 10 seconds." }) })
    : fakeFetch(url, opts)));
  try {
    const veg = await places({ what: "vegan restaurant", area: "Khar" }, { cityLabel: "Mumbai", currency: "INR" }); // a query no earlier test cached
    assert.ok(veg.places.length > 0, "falls back to the text search");
    assert.match(veg.note, /Couldn't check which are vegan restaurants/);
    assert.match(veg.for_agent, /not filtered/);
  } finally {
    setFetch(fakeFetch);
  }
});

test("calendar entries are 'ready to add', never 'added'", async () => {
  assert.equal(calendarWording("Calendar entry added with reminders."), "Calendar entry ready to add with reminders.");
  assert.equal(calendarWording("A calendar entry with reminders is added."), "A calendar entry with reminders ready to add.");
  assert.equal(calendarWording("I've added it to your calendar."), "it's ready to add to your calendar.");
  assert.equal(calendarWording("Added them to your calendar."), "they're ready to add to your calendar.");
  assert.equal(calendarWording("Mom's birthday reminders set."), "Mom's birthday reminders ready to add.");
  assert.equal(calendarWording("Booked dinner and set up your reminders."), "Booked dinner and got your reminders ready to add.");
  assert.equal(calendarWording("Table set for 4 at 20:00."), "Table set for 4 at 20:00.", "other uses of 'set' are left alone");
  const events = [];
  const state = freshState();
  const out = JSON.parse((await execute("add_calendar_event", { errand_ref: "E1", title: "Dinner", start: plus(2) + "T20:00" }, state, (e) => events.push(e))).content);
  assert.equal(out.ready_to_add, true);
  assert.equal(out.added, undefined);
  await execute("finish", { headline: "Calendar entry added.", errands: [{ ref: "E1", status: "scheduled", outcome: "Reminders set for Sunday." }] }, state, (e) => events.push(e));
  const plan = events.find((e) => e.t === "plan").plan;
  assert.equal(plan.headline, "Calendar entry ready to add.");
  assert.equal(plan.errands[0].outcome, "Reminders ready to add for Sunday.");
});

test("an ambiguous time gets the other reading as a one-tap switch", async () => {
  const state = freshState();
  const events = [];
  const emit = (e) => events.push(e);
  const am = JSON.parse((await execute("add_calendar_event", { errand_ref: "E1", title: "Flight to Delhi", start: plus(5) + "T06:30", ambiguous_time: true }, state, emit)).content);
  assert.equal(events[0].event.alt_start, plus(5) + "T18:30");
  assert.equal(events[0].event.read_as, "am");
  assert.match(am.note, /switch it to 18:30 \(pm\)/);
  await execute("add_calendar_event", { errand_ref: "E2", title: "Show", start: plus(5) + "T20:00", ambiguous_time: true }, state, emit);
  assert.equal(events[1].event.alt_start, plus(5) + "T08:00", "pm flips to am, same day");
  await execute("add_calendar_event", { errand_ref: "E3", title: "Dinner", start: plus(5) + "T20:00" }, state, emit);
  assert.equal(events[2].event.alt_start, undefined, "unflagged times stay as they are");
  await execute("add_calendar_event", { errand_ref: "E4", title: "Birthday", start: plus(6), ambiguous_time: true }, state, emit);
  assert.equal(events[3].event.alt_start, undefined, "all-day entries have no time to flip");
  assert.equal(events[0].event.tz, "Asia/Kolkata", "every timed entry carries its city's zone");
});

test("gateway: every service gets a usable slot id, and holds are refused for slots never offered", () => {
  // ac_service used to produce "FX-AC_-..." ids that the gateway's own parser rejected.
  for (const service of ["plumbing", "electrical", "ac_service", "appliance_repair", "pest_control", "deep_cleaning"]) {
    const search = handle("fixit-home", "visit.search", { service, date_from: plus(2), part_of_day: "morning" }, ctx);
    assert.ok(search.ok && search.slots.length, service);
    const hold = handle("fixit-home", "visit.hold", { slot_id: search.slots[0].slot_id, customer_first_name: "A", issue_summary: "Check" }, ctx);
    assert.ok(hold.ok, `${service}: ${JSON.stringify(hold)}`);
  }
  for (const specialty of ["gp", "dentist", "dermatology", "physio"]) {
    const search = handle("citycare-clinic", "slots.search", { specialty, date_from: plus(2), part_of_day: "afternoon" }, ctx);
    const hold = handle("citycare-clinic", "appointment.hold", { slot_id: search.slots[0].slot_id, patient_first_name: "A", visit_reason: "routine" }, ctx);
    assert.ok(hold.ok, specialty);
    assert.equal(hold.offer.amount, { gp: 800, dentist: 1200, dermatology: 1500, physio: 1000 }[specialty], `${specialty} keeps its own fee`);
  }
  const real = handle("fixit-home", "visit.search", { service: "ac_service", date_from: plus(2), part_of_day: "morning" }, ctx).slots[0].slot_id;
  const day = real.split("-")[2];
  const guess = (id) => handle("fixit-home", "visit.hold", { slot_id: id, customer_first_name: "A", issue_summary: "Check" }, ctx);
  assert.match(guess(`FX-AC-${day}-1200`).error.message, /no "AC" service/, "a made-up key");
  assert.match(guess(`FX-ZZZ-${day}-1200`).error.message, /no "ZZZ" service/);
  assert.match(guess("FX-ACS-20200101-1200").error.message, /in the past/);
  assert.match(guess(`FX-ACS-${day}-0300`).error.message, /opening hours/);
  // Its availability rule marks about a quarter of slots taken; guessing through the day must hit some.
  let refused = 0, accepted = 0;
  for (let m = 540; m <= 1290; m += 30) {
    const r = guess(`FX-ACS-${day}-${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`);
    if (r.ok) accepted++; else { assert.match(r.error.message, /isn't available/); refused++; }
  }
  assert.ok(refused > 0 && accepted > 0, `refused ${refused}, accepted ${accepted}`);
});

test("finish: a quote the visitor must complete is human_only, whatever the model said; 'None' next steps are dropped", async () => {
  const state = freshState();
  state.errands = [{ ref: "E1", title: "Car insurance" }, { ref: "E2", title: "Dentist" }, { ref: "E3", title: "Weather" }];
  const events = [];
  const emit = (e) => events.push(e);
  const quote = await call(state, "E1", "shieldsure", "renewal.quote", { product: "car", current_expiry: plus(16), claims_last_year: "no" });
  assert.equal(quote.human_required, true);
  const search = await call(state, "E2", "citycare-clinic", "slots.search", { specialty: "dentist", date_from: plus(2), part_of_day: "evening" });
  const held = await call(state, "E2", "citycare-clinic", "appointment.hold", { slot_id: search.slots[0].slot_id, patient_first_name: "A", visit_reason: "routine" });
  state.approvals[held.offer.offer_id] = true; // the slot may not be in the evening; that's not what this test is about
  assert.equal((await commitIt(state, "E2", held.offer.offer_id)).status, "confirmed");
  await execute("finish", { headline: "Done.", errands: [
    { ref: "E1", status: "scheduled", outcome: "Quote ready, reminders ready to add.", your_next_step: "Complete KYC." },
    { ref: "E2", status: "done", outcome: "Booked." },
    { ref: "E3", status: "done", outcome: "Clear.", your_next_step: "None." },
  ] }, state, emit);
  const plan = events.find((e) => e.t === "plan").plan;
  assert.equal(plan.errands[0].status, "human_only", "the model said scheduled; the server knows better");
  assert.equal(plan.errands[1].status, "done", "a booked errand keeps its status");
  assert.equal(plan.errands[2].your_next_step, "", "'None.' is not a next step");
});

test("live lookups in one turn run together, not one after another", async () => {
  const delay = 250;
  setFetch((url, opts) => new Promise((r) => setTimeout(() => r(fakeFetch(url, opts)), delay)));
  try {
    const state = freshState();
    let turn = 0;
    const client = { messages: { create: async () => {
      turn++;
      const use = (name, input) => ({ type: "tool_use", id: `toolu_${turn}_${name}`, name, input });
      if (turn === 1) return { content: [
        use("check_weather", { errand_ref: "E1", place: "Delhi", date_from: plus(3), days: 1 }),
        use("find_places", { errand_ref: "E2", what: "restaurant", area: "Bandra West" }),
        use("convert_currency", { errand_ref: "E3", amount: 100, from: "USD", to: "INR" }),
      ], stop_reason: "tool_use", usage: {} };
      return { content: [use("finish", { headline: "ok", errands: [] })], stop_reason: "tool_use", usage: {} };
    } }, beta: { messages: { create: async (p) => client.messages.create(p) } } };
    const started = Date.now();
    assert.equal(await runLoop(state, () => {}, { client }), "done");
    const took = Date.now() - started;
    // Weather is 2 fetches and places 2 (geocode + Overpass): about 4 delays if run together, 6 or more if not.
    assert.ok(took < delay * 5.5, `took ${took} ms`);
    const answered = state.messages[2].content.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id).sort();
    assert.deepEqual(answered, ["toolu_1_check_weather", "toolu_1_convert_currency", "toolu_1_find_places"], "every call answered");
  } finally {
    setFetch(fakeFetch);
  }
});
