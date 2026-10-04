// Executes the concierge's tool calls. The mandate is enforced here, in code: the model can
// ask for anything, but an offer over the cap is never committed, and an offer over the
// ask-me line (or an irreversible one) is never committed without the visitor's click.

import { BUSINESSES, CITIES, handle, commit, agentCard, niceDate } from "./gateway.js";
import { weather, places, fx, flight } from "./live.js";
import { consumeDaily } from "./limits.js";

const AGENT_ID = "agent://friday-musings/concierge";

export function money(currency, n) {
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

// Errand refs (E1, E2, ...) are the agent's bookkeeping. If one slips into text the visitor reads,
// drop it where it's a parenthetical and name the errand where it's part of the sentence.
export function unref(text, state) {
  const titles = Object.fromEntries((state.errands || []).map((e) => [e.ref, e.title]));
  const refs = Object.keys(titles).map((r) => r.replace(/[^\w-]/g, "")).filter(Boolean);
  if (!text || !refs.length) return text;
  const alt = refs.join("|");
  return String(text)
    .replace(new RegExp(`\\s*\\((?:errands?\\s+)?(?:${alt})(?:\\s*(?:,|and|&)\\s*(?:${alt}))*\\)`, "gi"), "")
    .replace(new RegExp(`\\b(?:errand\\s+)?(${alt})\\b`, "gi"), (_, r) => `“${titles[Object.keys(titles).find((k) => k.toLowerCase() === r.toLowerCase())]}”`);
}

const ok = (obj) => ({ content: JSON.stringify(obj) });
const err = (code, message) => ({ content: JSON.stringify({ error: code, message }), is_error: true });
const str = (v, max) => String(v ?? "").trim().slice(0, max);

// The ask-me line is inclusive: "ask before anything ₹1,500 or more". An offer that isn't what the
// visitor asked for (another day, time or part of the day) also comes back to them, whatever it costs.
// Returns clauses that complete "I'm asking because ...". The approval sheet shows asked-vs-offered
// as its own rows, so it takes the short form.
export function approvalReasons(offer, mandate, { short = false } = {}) {
  const why = [];
  const d = offer.differs_from_request;
  if (offer.requires_approval) why.push("it can't be undone, and that always comes back to you");
  if (d) why.push(short ? "it isn't what you asked for" : `it isn't what you asked for (you said ${d.asked}; the closest I could get is ${d.offered})`);
  if (offer.amount > 0 && offer.amount >= mandate.askAbove) {
    const amount = money(offer.currency, offer.amount);
    why.push(offer.amount === mandate.askAbove ? `it's ${amount}, which is your ask-me line` : `it's ${amount}, over your ${money(offer.currency, mandate.askAbove)} ask-me line`);
  }
  return why;
}

export function needsApproval(offer, mandate) {
  return approvalReasons(offer, mandate).length > 0;
}

// What the visitor asked for, per errand, recorded at the first search so the agent can't move the
// goalposts by searching again. `asked_for` is the agent's account of what the visitor said; without
// it, a table search's own date and time stand in (conservative: a different slot then asks).
const PARTS_OF_DAY = { morning: [360, 720], afternoon: [720, 1020], evening: [1020, 1380] };
const SEARCH_INTENTS = new Set(["availability.search", "slots.search", "visit.search"]);

function recordAsked(state, ref, intent, params, askedFor) {
  if (!ref || !SEARCH_INTENTS.has(intent)) return;
  state.asked ??= {};
  const prev = state.asked[ref];
  if (prev?.explicit) return;
  const a = askedFor && typeof askedFor === "object" ? askedFor : null;
  const pick = (v, re) => (re.test(String(v ?? "")) ? String(v) : undefined);
  const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/, PART = /^(morning|afternoon|evening)$/;
  if (a) {
    state.asked[ref] = { explicit: true, date: pick(a.date, DATE), time: pick(a.time, TIME), part: pick(a.part_of_day, PART) };
  } else if (!prev) {
    state.asked[ref] = intent === "availability.search"
      ? { date: pick(params.date, DATE), time: pick(params.time, TIME) }
      : { part: pick(params.part_of_day, PART) };
  }
}

function differsFromRequest(asked, start) {
  if (!asked || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(start || ""))) return null;
  const date = start.slice(0, 10), time = start.slice(11, 16);
  const mins = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const range = asked.part && PARTS_OF_DAY[asked.part];
  const off = (asked.date && asked.date !== date) || (asked.time && asked.time !== time) || (range && !asked.time && (mins < range[0] || mins >= range[1]));
  if (!off) return null;
  const said = [asked.date && niceDate(asked.date), asked.time || (!asked.time && asked.part)].filter(Boolean).join(", ");
  return { asked: said, offered: `${niceDate(date)}, ${time}` };
}

function gatewayCtx(state) {
  return { currency: state.currency, today: state.today, principal: state.firstName || "anonymous visitor", agent_id: AGENT_ID };
}

const EXECUTORS = {
  list_errands(input, state, emit) {
    const errands = (Array.isArray(input.errands) ? input.errands : []).slice(0, 6).map((e, i) => ({
      ref: str(e.ref, 6) || `E${i + 1}`, title: str(e.title, 80), category: str(e.category, 24),
    }));
    state.errands = errands;
    emit({ t: "errands", errands });
    return ok({ registered: errands.length });
  },

  find_businesses(input, state, emit) {
    const origin = state.origin;
    const found = Object.entries(BUSINESSES).filter(([, b]) => b.category === input.category);
    for (const [id] of found) emit({ t: "wire", ref: input.errand_ref, line: `GET /gateway/${id}/agent-card.json → 200`, detail: BUSINESSES[id].name, ok: true });
    if (!found.length) {
      emit({ t: "wire", ref: input.errand_ref, line: `DISCOVER category=${str(input.category, 24)} → none`, detail: "No business with an agent gateway", ok: false });
      return ok({ businesses: [], note: "No demo gateway in this category. Use calendar entries and drafts instead." });
    }
    emit({ t: "ledger", kind: "ok", title: "Counterparty discovered", detail: found.map(([, b]) => `${b.name} (demo) · agent gateway`).join(", ") });
    return ok({ city: CITIES[state.city].label, businesses: found.map(([id]) => agentCard(id, origin)) });
  },

  call_gateway(input, state, emit) {
    const { business_id: bizId, intent } = input;
    if (intent === "offer.commit") return err("USE_COMMIT_OFFER", "Commit offers with the commit_offer tool.");
    const params = input.params && typeof input.params === "object" ? input.params : {};
    const res = handle(bizId, intent, params, gatewayCtx(state));
    if (res.ok) recordAsked(state, input.errand_ref, intent, params, input.asked_for);
    const biz = BUSINESSES[bizId];
    const line = `POST /gateway/${bizId} intent=${str(intent, 40)}`;
    if (!res.ok) {
      emit({ t: "wire", ref: input.errand_ref, line, detail: `${res.error.code}: ${res.error.message}`, ok: false });
      if (res.error.code === "SENSITIVE_DATA_REJECTED") {
        emit({ t: "ledger", kind: "bad", title: "Sensitive data blocked", detail: `${biz?.name ?? bizId} refused a request containing personal identifiers` });
      }
      return err(res.error.code, res.error.message);
    }
    if (res.offer) {
      const o = res.offer;
      const differs = differsFromRequest(state.asked?.[input.errand_ref], o.start);
      if (differs) o.differs_from_request = differs;
      state.offers[o.offer_id] = { offer: o, token: res.offer_token, ref: input.errand_ref };
      emit({ t: "wire", ref: input.errand_ref, line, detail: `OFFER ${o.offer_id} · ${o.summary} · ${money(o.currency, o.amount)}`, ok: true });
      emit({ t: "offer", ref: input.errand_ref, offer: o });
      emit({ t: "ledger", kind: "ok", title: "Structured offer", detail: `${o.business_name} · ${money(o.currency, o.amount)} · ${o.payment}` });
      const { offer_token, ...visible } = res;
      const why = approvalReasons(o, state.mandate);
      return ok({ ...visible, approval: why.length ? `required before commit, because ${why.join("; and ")}` : "auto-approved by the mandate" });
    }
    const n = Array.isArray(res.slots) ? `${res.slots.length} slots` : res.quote_id ? `QUOTE ${res.quote_id} · ${money(res.currency, res.indicative_premium)} (indicative)` : "ok";
    emit({ t: "wire", ref: input.errand_ref, line, detail: n, ok: true });
    if (res.human_required) emit({ t: "ledger", kind: "warn", title: "Human step required", detail: `${biz.name}: ${res.next_step}` });
    return ok(res);
  },

  request_approval(input, state, emit) {
    const held = state.offers[input.offer_id];
    if (!held) return err("UNKNOWN_OFFER", "No offer with that offer_id. Get one from a hold intent first.");
    const { offer } = held;
    if (offer.amount > state.mandate.cap) return err("MANDATE_CAP_EXCEEDED", `This costs ${money(offer.currency, offer.amount)}; the visitor's cap is ${money(offer.currency, state.mandate.cap)}. Don't ask; report it in finish.`);
    if (input.offer_id in state.approvals) return ok({ decision: state.approvals[input.offer_id] ? "approved" : "declined" });
    const why = approvalReasons(offer, state.mandate);
    if (!why.length) return ok({ decision: "not needed", message: "Within the auto-approve limit. Call commit_offer." });
    const reasons = [offer.requires_approval && "Irreversible action", offer.differs_from_request && "Not what you asked for", offer.amount > 0 && offer.amount >= state.mandate.askAbove && `At or above the ask-me line of ${money(offer.currency, state.mandate.askAbove)}`].filter(Boolean);
    emit({ t: "ledger", kind: "warn", title: "Approval requested", detail: reasons.join(" · ") });
    return { pause: { offer, why: approvalReasons(offer, state.mandate, { short: true }), ref: input.errand_ref, question: unref(str(input.question, 240), state) || `Approve: ${offer.summary}?` } };
  },

  commit_offer(input, state, emit) {
    const held = state.offers[input.offer_id];
    if (!held) return err("UNKNOWN_OFFER", "No offer with that offer_id.");
    const { offer, token } = held;
    if (offer.amount > state.mandate.cap) {
      emit({ t: "ledger", kind: "bad", title: "Blocked by mandate", detail: `${money(offer.currency, offer.amount)} is over the cap of ${money(offer.currency, state.mandate.cap)}. Nothing committed.` });
      return err("MANDATE_CAP_EXCEEDED", "Over the visitor's spending cap. Do not commit. Report it in finish and suggest raising the cap.");
    }
    if (needsApproval(offer, state.mandate)) {
      if (state.approvals[input.offer_id] === false) return err("DECLINED_BY_VISITOR", "The visitor declined. Do not retry.");
      if (state.approvals[input.offer_id] !== true) return err("APPROVAL_REQUIRED", `The visitor must approve this first, because ${approvalReasons(offer, state.mandate).join("; and ")}. Call request_approval for this offer.`);
    }
    const res = commit(token, gatewayCtx(state));
    if (!res.ok) {
      emit({ t: "wire", ref: input.errand_ref, line: `POST /gateway/${offer.business_id} intent=offer.commit`, detail: res.error.code, ok: false });
      return err(res.error.code, res.error.message);
    }
    delete state.offers[input.offer_id];
    state.receiptCount += 1;
    emit({ t: "wire", ref: input.errand_ref, line: `POST /gateway/${offer.business_id} intent=offer.commit`, detail: `CONFIRMED · ${res.receipt.receipt_id}`, ok: true });
    emit({ t: "receipt", ref: input.errand_ref, receipt: res.receipt });
    emit({ t: "ledger", kind: "ok", title: "Signed receipt", detail: `${res.receipt.receipt_id} · ${money(offer.currency, offer.amount)} · Ed25519` });
    return ok({ status: "confirmed", receipt_id: res.receipt.receipt_id, summary: offer.summary, start: offer.start, duration_minutes: offer.duration_minutes });
  },

  add_calendar_event(input, state, emit) {
    const start = str(input.start, 16);
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(start)) return err("BAD_START", "start must be YYYY-MM-DD or YYYY-MM-DDTHH:MM");
    const event = {
      title: unref(str(input.title, 100), state), start, all_day: start.length === 10,
      duration_minutes: Math.min(Math.max(Number(input.duration_minutes) || 30, 5), 600),
      reminders: (Array.isArray(input.reminders_minutes_before) ? input.reminders_minutes_before : []).map(Number).filter((n) => n >= 0 && n <= 43200).slice(0, 3),
      location: unref(str(input.location, 120), state), notes: unref(str(input.notes, 400), state), tz: CITIES[state.city].tz,
    };
    emit({ t: "calendar", ref: input.errand_ref, event });
    return ok({ added: true });
  },

  draft_message(input, state, emit) {
    const channel = ["whatsapp", "email", "sms"].includes(input.channel) ? input.channel : "whatsapp";
    const draft = { channel, to_name: str(input.to_name, 60), to_contact: str(input.to_contact, 80), subject: unref(str(input.subject, 120), state), body: unref(str(input.body, 1200), state) };
    if (!draft.body) return err("EMPTY", "body is required");
    emit({ t: "draft", ref: input.errand_ref, draft });
    return ok({ drafted: true });
  },

  finish(input, state, emit) {
    const plan = {
      headline: unref(str(input.headline, 200), state),
      errands: (Array.isArray(input.errands) ? input.errands : []).slice(0, 6).map((e) => ({
        ref: str(e.ref, 6), status: str(e.status, 16), outcome: unref(str(e.outcome, 400), state), your_next_step: unref(str(e.your_next_step, 300), state),
      })),
    };
    state.done = true;
    emit({ t: "plan", plan });
    return ok({ finished: true });
  },
};

// Live-data tools: real APIs. Each emits a "live" event the page shows as found-on-the-way.
const deg = (n) => (n == null ? "?" : Math.round(n) + "°");
const LIVE = {
  async check_weather(input, state, emit) {
    const out = await weather(input, { today: state.today });
    if (out.error) return out;
    emit({ t: "live", ref: input.errand_ref, kind: "weather", source: out.source, title: `Weather · ${out.place.split(",")[0]}`,
      lines: out.days.map((d) => `${niceDate(d.date)}: ${deg(d.max_c)} / ${deg(d.min_c)}, ${d.summary}${d.rain_chance_pct >= 30 ? `, ${d.rain_chance_pct}% chance of rain` : ""}`) });
    return out;
  },
  async find_places(input, state, emit) {
    const out = await places(input, { cityLabel: CITIES[state.city].label, currency: state.currency });
    if (out.error) return out;
    emit({ t: "live", ref: input.errand_ref, kind: "places", source: out.source, title: `Real places · ${String(input.what || "").slice(0, 40)}`,
      lines: out.places.length ? [] : [out.note], places: out.places });
    return out;
  },
  async convert_currency(input, state, emit) {
    const out = await fx(input);
    if (out.error) return out;
    emit({ t: "live", ref: input.errand_ref, kind: "fx", source: out.source, title: "Exchange rate",
      lines: [`${out.amount.toLocaleString()} ${out.from} = ${out.converted.toLocaleString()} ${out.to} (rate ${out.rate}, ${String(out.as_of).slice(5, 16)})`] });
    return out;
  },
  async flight_status(input, state, emit) {
    const out = await flight(input, { today: state.today }, () => consumeDaily("flight", Number(process.env.FLIGHT_LOOKUPS_PER_DAY) || 40));
    if (out.error) {
      if (out.error === "NOT_CONNECTED") emit({ t: "ledger", kind: "warn", title: "Locked: flight status", detail: "Needs an API key; not connected in this demo yet" });
      return out;
    }
    const dep = out.departure, arr = out.arrival;
    emit({ t: "live", ref: input.errand_ref, kind: "flight", source: out.source, title: `${out.flight} · ${out.status}`,
      lines: [`Departs ${dep.airport} ${dep.scheduled.slice(11, 16)}${dep.revised && dep.revised !== dep.scheduled ? ` → now ${dep.revised.slice(11, 16)}` : ""}${dep.terminal ? ` · T${dep.terminal}` : ""}${dep.gate ? ` · gate ${dep.gate}` : ""}`,
        `Arrives ${arr.airport} ${arr.scheduled.slice(11, 16)}${arr.revised && arr.revised !== arr.scheduled ? ` → now ${arr.revised.slice(11, 16)}` : ""}`] });
    return out;
  },
};

export async function execute(name, input, state, emit) {
  const args = input && typeof input === "object" ? input : {};
  try {
    if (LIVE[name]) {
      const out = await LIVE[name](args, state, emit);
      if (out.error) {
        emit({ t: "wire", ref: args.errand_ref, line: `LIVE ${name}`, detail: out.message || out.error, ok: false });
        return { content: JSON.stringify(out), is_error: true };
      }
      emit({ t: "wire", ref: args.errand_ref, line: `LIVE ${name} → 200`, detail: out.source, ok: true });
      return ok(out);
    }
    const fn = EXECUTORS[name];
    if (!fn) return err("UNKNOWN_TOOL", `No tool named ${name}.`);
    return fn(args, state, emit);
  } catch (e) {
    console.error(JSON.stringify({ at: "tools.execute", tool: name, error: String(e?.message || e) }));
    return err("TOOL_FAILED", LIVE[name] ? "The live data source didn't answer. Say you couldn't check it; don't guess." : "The tool failed. Try a different approach.");
  }
}
