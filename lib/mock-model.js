// A scripted stand-in for the model, for local development and tests (MOCK_MODEL=1).
// It reads the conversation so far and makes the next sensible tool calls for the sample
// errands, so the UI, mandate checks, approvals and receipts can be exercised for free.

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
      { type: "text", text: "Five errands. Three of them have demo gateways, so I can actually do those." },
      use("list_errands", { errands: [
        { ref: "E1", title: "Dinner for 4 on Thursday", category: "restaurant" },
        { ref: "E2", title: "Dentist appointment next week", category: "clinic" },
        { ref: "E3", title: "Cancel gym membership", category: "fitness_membership" },
        { ref: "E4", title: "Mom's birthday on Saturday", category: "reminder" },
        { ref: "E5", title: "Pay society maintenance", category: "payment" },
      ] }),
      use("find_businesses", { errand_ref: "E1", category: "restaurant" }),
      use("find_businesses", { errand_ref: "E2", category: "clinic" }),
      use("find_businesses", { errand_ref: "E3", category: "fitness_membership" }),
    ]);
  }
  if (turns === 1) {
    return reply([
      use("call_gateway", { errand_ref: "E1", business_id: "saffron-room", intent: "availability.search", params: { date: addDays(today, 5), time: "20:00", party_size: 4 } }),
      use("call_gateway", { errand_ref: "E2", business_id: "citycare-clinic", intent: "slots.search", params: { specialty: "dentist", date_from: addDays(today, 2), part_of_day: "evening" } }),
      use("call_gateway", { errand_ref: "E3", business_id: "pulse-fitness", intent: "membership.cancel_quote", params: { member_first_name: "Sandip", effective: "end_of_cycle" } }),
    ]);
  }
  if (turns === 2) {
    const slot = (intent) => results.find((r) => r.call?.input.intent === intent)?.body.slots?.[0]?.slot_id;
    return reply([
      use("call_gateway", { errand_ref: "E1", business_id: "saffron-room", intent: "table.hold", params: { slot_id: slot("availability.search"), party_size: 4, guest_first_name: "Sandip", dietary_notes: "1 vegetarian" } }),
      use("call_gateway", { errand_ref: "E2", business_id: "citycare-clinic", intent: "appointment.hold", params: { slot_id: slot("slots.search"), patient_first_name: "Sandip", visit_reason: "routine" } }),
      use("add_calendar_event", { errand_ref: "E4", title: "Mom's birthday", start: addDays(today, 7), reminders_minutes_before: [4320, 0] }),
      use("draft_message", { errand_ref: "E5", channel: "whatsapp", to_name: "Society office", body: "Hi, please share this month's maintenance amount and the UPI ID. I'll pay today. Thanks, Sandip" }),
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
  const out = ["E1", "E2", "E3"].map((ref) => ({ ref, status: status(ref)?.[0] ?? "skipped", outcome: status(ref)?.[1] ?? "No offer." }));
  return reply([
    use("finish", { headline: "Booked what had a gateway, scheduled the birthday, and drafted the society message.", errands: [
      ...out,
      { ref: "E4", status: "scheduled", outcome: "All-day entry with a reminder three days before for a gift." },
      { ref: "E5", status: "human_only", outcome: "Payment needs your UPI PIN, so I drafted a WhatsApp to the society office asking for the amount.", your_next_step: "Send the draft, then pay by UPI." },
    ] }),
  ]);
}

const create = async (params) => next(params.messages);
export const mockClient = { messages: { create }, beta: { messages: { create } } };
