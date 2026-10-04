// A scripted stand-in for the model, for local development and tests (MOCK_MODEL=1).
// It reads the conversation so far and makes the next sensible tool calls for the sample
// errands, so the UI, mandate checks, approvals and receipts can be exercised for free.

import { setFetch } from "./live.js";
import { fakeFetch } from "./mock-live.js";

setFetch(fakeFetch);
let n = 0;
const use = (name, input) => ({ type: "tool_use", id: `toolu_mock_${++n}`, name, input });
const reply = (content, stop = "tool_use") => ({
  content: [{ type: "thinking", thinking: "", signature: "mock" }, ...content],
  stop_reason: stop,
  usage: { input_tokens: 900, output_tokens: 350, cache_read_input_tokens: 3800, cache_creation_input_tokens: 0 },
});

function addDays(date, d) {
  return new Date(Date.parse(date + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);
}

function history(messages) {
  const calls = new Map();
  const results = [];
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === "tool_use") calls.set(b.id, b);
      if (b.type === "tool_result") {
        let body = {};
        try { body = JSON.parse(b.content); } catch { /* ignore */ }
        results.push({ call: calls.get(b.tool_use_id), body, error: Boolean(b.is_error) });
      }
    }
  }
  return results;
}

function next(messages) {
  const turns = messages.filter((m) => m.role === "assistant").length;
  const today = /(\d{4}-\d{2}-\d{2})/.exec(String(messages[0].content))[1];
  const results = history(messages);

  if (turns === 0) {
    return reply([
      { type: "text", text: "Four errands. I can book two with demo businesses and check the rest against live data." },
      use("list_errands", { errands: [
        { ref: "E1", title: "Friday flight to Delhi", category: "travel" },
        { ref: "E2", title: "Thursday dinner for 4", category: "restaurant" },
        { ref: "E3", title: "Plumber Saturday morning", category: "home_services" },
        { ref: "E4", title: "Mom's birthday Sunday", category: "reminder" },
      ] }),
      use("check_weather", { errand_ref: "E1", place: "Delhi", date_from: addDays(today, 5), days: 1 }),
      use("find_businesses", { errand_ref: "E2", category: "restaurant" }),
      use("find_places", { errand_ref: "E2", what: "restaurant", area: "Bandra West" }),
      use("find_businesses", { errand_ref: "E3", category: "home_services" }),
    ]);
  }
  if (turns === 1) {
    return reply([
      use("call_gateway", { errand_ref: "E2", business_id: "saffron-room", intent: "availability.search", params: { date: addDays(today, 4), time: "20:00", party_size: 4 } }),
      use("call_gateway", { errand_ref: "E3", business_id: "fixit-home", intent: "visit.search", params: { service: "plumbing", date_from: addDays(today, 6), part_of_day: "morning" } }),
    ]);
  }
  if (turns === 2) {
    const slot = (intent) => results.find((r) => r.call?.input.intent === intent)?.body.slots?.[0]?.slot_id;
    return reply([
      use("call_gateway", { errand_ref: "E2", business_id: "saffron-room", intent: "table.hold", params: { slot_id: slot("availability.search"), party_size: 4, guest_first_name: "Sandip", dietary_notes: "1 vegetarian" } }),
      use("call_gateway", { errand_ref: "E3", business_id: "fixit-home", intent: "visit.hold", params: { slot_id: slot("visit.search"), customer_first_name: "Sandip", issue_summary: "Leaking kitchen tap" } }),
      use("add_calendar_event", { errand_ref: "E1", title: "Leave for the airport (06:30 flight to Delhi)", start: addDays(today, 5) + "T04:15", duration_minutes: 30, reminders_minutes_before: [60] }),
      use("add_calendar_event", { errand_ref: "E4", title: "Mom's birthday", start: addDays(today, 7), reminders_minutes_before: [4320, 0] }),
      use("draft_message", { errand_ref: "E4", channel: "whatsapp", to_name: "Mom", body: "Happy birthday Mom! Lunch on Sunday?" }),
    ]);
  }

  const offers = results.filter((r) => r.body.offer).map((r) => ({ ref: r.call.input.errand_ref, id: r.body.offer.offer_id, offer: r.body.offer }));
  const commits = (id) => results.filter((r) => r.call?.name === "commit_offer" && r.call.input.offer_id === id);
  const decision = (id) => results.find((r) => r.call?.name === "request_approval" && r.call.input.offer_id === id)?.body.decision;
  const actions = [];
  for (const o of offers) {
    const tries = commits(o.id);
    const last = tries[tries.length - 1];
    if (!last) actions.push(use("commit_offer", { errand_ref: o.ref, offer_id: o.id }));
    else if (last.body.error === "APPROVAL_REQUIRED" && !decision(o.id) && !actions.some((a) => a.name === "request_approval")) {
      actions.push(use("request_approval", { errand_ref: o.ref, offer_id: o.id, question: `${o.offer.summary}. OK to go ahead?` }));
    } else if (last.body.error === "APPROVAL_REQUIRED" && decision(o.id) === "approved") actions.push(use("commit_offer", { errand_ref: o.ref, offer_id: o.id }));
  }
  if (actions.length) return reply(actions);

  const status = (ref) => {
    const o = offers.find((x) => x.ref === ref);
    if (!o) return null;
    const done = commits(o.id).some((r) => r.body.status === "confirmed");
    return done ? ["done", `Confirmed with ${o.offer.business_name} (demo). Signed receipt attached.`] : ["skipped", "Not committed: you declined it or it was over your cap."];
  };
  const out = ["E2", "E3"].map((ref) => ({ ref, status: status(ref)?.[0] ?? "skipped", outcome: status(ref)?.[1] ?? "No offer." }));
  return reply([
    use("finish", { headline: "Booked dinner and the plumber, checked Delhi's weather, and set up your reminders.", errands: [
      { ref: "E1", status: "scheduled", outcome: "Delhi on Friday: showers likely. Reminder set to leave at 04:15.", your_next_step: "Add your flight number and I'll check it's on time." },
      ...out,
      { ref: "E4", status: "scheduled", outcome: "All-day entry with a reminder three days before, and a WhatsApp ready for Mom." },
    ] }),
  ]);
}

const create = async (params) => next(params.messages);
export const mockClient = { messages: { create }, beta: { messages: { create } } };
