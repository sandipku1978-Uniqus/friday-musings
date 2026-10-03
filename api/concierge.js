// POST /api/concierge — runs the live concierge and streams its work as NDJSON.
//
// New run:   { errands, city, first_name?, cap, ask_above }
// Resume:    { resume: <sealed state>, decision: "approve" | "decline" | "continue" }

import { CITIES, todayIn } from "../lib/gateway.js";
import { seal, unseal, usingDevSecret } from "../lib/sign.js";
import { checkLimit } from "../lib/limits.js";
import { runLoop, applyDecision, MODEL } from "../lib/agent.js";
import { money } from "../lib/tools.js";

const MAX_CAP = { INR: 50000, AED: 2000, USD: 600 };
const RUN_BUDGET_MS = Number(process.env.RUN_BUDGET_MS) || 280000;
const STATE_TTL_MS = 30 * 60000;

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

function originOf(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${proto}://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

function brief(state, text) {
  const city = CITIES[state.city];
  const now = new Date();
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: city.tz, weekday: "long" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: city.tz, hour: "2-digit", minute: "2-digit" }).format(now);
  const m = (n) => money(state.currency, n);
  return [
    `Today is ${weekday}, ${state.today}, ${time} local time in ${city.label} (time zone ${city.tz}). Currency: ${state.currency}.`,
    `Visitor's first name: ${state.firstName || "not given; sign drafts without a name"}.`,
    `Mandate: spending cap ${m(state.mandate.cap)} per errand. Commit without asking up to ${m(state.mandate.askAbove)}; above that the visitor approves. Irreversible actions, such as cancellations, always need approval.`,
    "Errands, exactly as the visitor typed them:",
    "<errands>", text, "</errands>",
  ].join("\n");
}

function newState(body, origin) {
  const text = String(body.errands || "").trim();
  if (!text) return { error: "Write at least one errand." };
  if (text.length > 1200) return { error: "Keep the errands under 1,200 characters." };
  const cityKey = String(body.city || "");
  const city = CITIES[cityKey];
  if (!city) return { error: "Pick a city from the list." };
  const firstName = String(body.first_name || "").trim();
  if (firstName && !/^[\p{L}][\p{L} .'-]{0,29}$/u.test(firstName)) return { error: "First name can only contain letters." };
  const max = MAX_CAP[city.currency];
  const cap = Math.min(Math.max(Math.round(Number(body.cap) || 0), 0), max);
  const askAbove = Math.min(Math.max(Math.round(Number(body.ask_above) || 0), 0), cap);
  const state = {
    v: 1, created: Date.now(), origin, city: cityKey, currency: city.currency, today: todayIn(city.tz),
    firstName, mandate: { cap, askAbove }, messages: [], turns: 0, nudged: false, done: false,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    errands: [], offers: {}, approvals: {}, receiptCount: 0, pending: null,
  };
  state.messages.push({ role: "user", content: brief(state, text) });
  return { state };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    return res.end();
  }
  const send = (status, obj) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
  };
  const mock = process.env.MOCK_MODEL === "1" && process.env.VERCEL_ENV !== "production";
  if (process.env.VERCEL_ENV === "production" && usingDevSecret) return send(503, { error: "The concierge isn't configured yet (RECEIPT_SECRET is missing)." });
  if (!process.env.ANTHROPIC_API_KEY && !mock) return send(503, { error: "The concierge isn't configured yet (ANTHROPIC_API_KEY is missing)." });

  const body = readBody(req);
  let state;
  if (body.resume) {
    state = unseal("state", body.resume);
    if (!state || state.v !== 1) return send(400, { error: "This run can't be resumed. Start a new one." });
    if (Date.now() - state.created > STATE_TTL_MS) return send(410, { error: "This run expired. Start a new one." });
    const limit = await checkLimit(req, "resume");
    if (!limit.ok) return send(429, { error: limit.message });
  } else {
    const made = newState(body, originOf(req));
    if (made.error) return send(400, { error: made.error });
    const limit = await checkLimit(req, "run");
    if (!limit.ok) return send(429, { error: limit.message });
    state = made.state;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  const emit = (obj) => res.write(JSON.stringify(obj) + "\n");

  try {
    if (body.resume) {
      if (state.pending && (body.decision === "approve" || body.decision === "decline")) applyDecision(state, body.decision, emit);
      else if (state.pending) return emit({ t: "error", message: "Approve or decline the pending request first." });
    } else {
      const m = (n) => money(state.currency, n);
      emit({ t: "run", model: MODEL, city: CITIES[state.city].label, currency: state.currency });
      emit({ t: "ledger", kind: "ok", title: "Mandate loaded", detail: `Cap ${m(state.mandate.cap)} per errand · ask above ${m(state.mandate.askAbove)} · irreversible actions always ask · expires in 30 min` });
    }
    const client = mock ? (await import("../lib/mock-model.js")).mockClient : undefined;
    const outcome = await runLoop(state, emit, { client, deadline: Date.now() + RUN_BUDGET_MS });
    if (outcome === "paused") {
      const p = state.pending;
      emit({ t: "approval", ref: p.ref, offer: p.offer, question: p.question, state: seal("state", state, { gzip: true }) });
    } else if (outcome === "continue") {
      emit({ t: "continue", state: seal("state", state, { gzip: true }) });
    }
  } catch (err) {
    const status = err?.status;
    console.error(JSON.stringify({ at: "api.concierge", status, error: String(err?.message || err) }));
    emit({ t: "error", message: status === 429 || status === 529
      ? "The model is busy right now. Please try again in a minute."
      : "Something went wrong while running your errands. Please try again." });
  } finally {
    emit({ t: "end" });
    res.end();
  }
}
