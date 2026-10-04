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

const ok = (obj) => ({ content: JSON.stringify(obj) });
const err = (code, message) => ({ content: JSON.stringify({ error: code, message }), is_error: true });
const str = (v, max) => String(v ?? "").trim().slice(0, max);

export function needsApproval(offer, mandate) {
  return Boolean(offer.requires_approval) || offer.amount > mandate.askAbove;
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
      state.offers[res.offer.offer_id] = { offer: res.offer, token: res.offer_token, ref: input.errand_ref };
      const o = res.offer;
      emit({ t: "wire", ref: input.errand_ref, line, detail: `OFFER ${o.offer_id} · ${o.summary} · ${money(o.currency, o.amount)}`, ok: true });
      emit({ t: "offer", ref: input.errand_ref, offer: o });
      emit({ t: "ledger", kind: "ok", title: "Structured offer", detail: `${o.business_name} · ${money(o.currency, o.amount)} · ${o.payment}` });
      const { offer_token, ...visible } = res;
      return ok({ ...visible, approval: needsApproval(o, state.mandate) ? "required before commit" : "auto-approved by the mandate" });
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
    if (!needsApproval(offer, state.mandate)) return ok({ decision: "not needed", message: "Within the auto-approve limit. Call commit_offer." });
    emit({ t: "ledger", kind: "warn", title: "Approval requested", detail: offer.requires_approval ? "Irreversible action" : `Above the ask-me line of ${money(offer.currency, state.mandate.askAbove)}` });
    return { pause: { offer, ref: input.errand_ref, question: str(input.question, 240) || `Approve: ${offer.summary}?` } };
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
      if (state.approvals[input.offer_id] !== true) return err("APPROVAL_REQUIRED", "Call request_approval for this offer first.");
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
      title: str(input.title, 100), start, all_day: start.length === 10,
      duration_minutes: Math.min(Math.max(Number(input.duration_minutes) || 30, 5), 600),
      reminders: (Array.isArray(input.reminders_minutes_before) ? input.reminders_minutes_before : []).map(Number).filter((n) => n >= 0 && n <= 43200).slice(0, 3),
      location: str(input.location, 120), notes: str(input.notes, 400), tz: CITIES[state.city].tz,
    };
    emit({ t: "calendar", ref: input.errand_ref, event });
    return ok({ added: true });
  },

  draft_message(input, state, emit) {
    const channel = ["whatsapp", "email", "sms"].includes(input.channel) ? input.channel : "whatsapp";
    const draft = { channel, to_name: str(input.to_name, 60), to_contact: str(input.to_contact, 80), subject: str(input.subject, 120), body: str(input.body, 1200) };
    if (!draft.body) return err("EMPTY", "body is required");
    emit({ t: "draft", ref: input.errand_ref, draft });
    return ok({ drafted: true });
  },

  finish(input, state, emit) {
    const plan = {
      headline: str(input.headline, 200),
      errands: (Array.isArray(input.errands) ? input.errands : []).slice(0, 6).map((e) => ({
        ref: str(e.ref, 6), status: str(e.status, 16), outcome: str(e.outcome, 400), your_next_step: str(e.your_next_step, 300),
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
