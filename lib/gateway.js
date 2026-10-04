// Demo businesses that answer AI agents.
//
// Each business publishes an agent card (what it can do, what it keeps for humans) and answers
// structured intents. Search intents are free; "hold" intents return an offer plus a sealed
// offer_token; committing the token returns an Ed25519-signed receipt. Nothing here is a real
// booking: the businesses are fictional and every response carries demo: true.

import crypto from "node:crypto";
import { seal, unseal, signReceipt, keyId, publicJwk } from "./sign.js";

export const CITIES = {
  mumbai: { label: "Mumbai", currency: "INR", tz: "Asia/Kolkata" },
  bengaluru: { label: "Bengaluru", currency: "INR", tz: "Asia/Kolkata" },
  delhi: { label: "Delhi NCR", currency: "INR", tz: "Asia/Kolkata" },
  dubai: { label: "Dubai", currency: "AED", tz: "Asia/Dubai" },
  newyork: { label: "New York", currency: "USD", tz: "America/New_York" },
};

const P = (INR, AED, USD) => ({ INR, AED, USD });
const PARTS = { morning: 600, afternoon: 840, evening: 1080, any: 660 }; // minutes after midnight

export const BUSINESSES = {
  "saffron-room": {
    code: "SR", name: "Saffron Room", category: "restaurant",
    tagline: "Modern Indian dining. Tables for 1 to 12.",
    intents: {
      "availability.search": { summary: "Find tables near a time", params: { date: "YYYY-MM-DD", time: "HH:MM, 24h", party_size: "1-12" } },
      "table.hold": { summary: "Hold a table. Returns an offer to commit.", params: { slot_id: "from availability.search", party_size: "1-12", guest_first_name: "first name only", dietary_notes: "optional, short" } },
    },
    humans_only: ["Private events over 12 guests", "Complaints"],
    data_policy: "First name and party details only.",
  },
  "citycare-clinic": {
    code: "CC", name: "CityCare Clinic", category: "clinic",
    tagline: "GP, dental, skin and physio consultations.",
    intents: {
      "slots.search": { summary: "Find appointment slots", params: { specialty: "gp | dentist | dermatology | physio", date_from: "YYYY-MM-DD", part_of_day: "morning | afternoon | evening | any" } },
      "appointment.hold": { summary: "Hold a slot. Returns an offer to commit.", params: { slot_id: "from slots.search", patient_first_name: "first name only", visit_reason: "routine | follow_up | new_issue" } },
    },
    humans_only: ["Diagnosis and prescriptions", "Test results", "Emergencies: call your local emergency number"],
    data_policy: "First name and a visit-reason category only. No symptom details, medical history or ID numbers.",
  },
  "fixit-home": {
    code: "FX", name: "FixIt Home Services", category: "home_services",
    tagline: "Plumbing, electrical, AC, appliances, pest control and cleaning.",
    intents: {
      "visit.search": { summary: "Find technician visit slots", params: { service: "plumbing | electrical | ac_service | appliance_repair | pest_control | deep_cleaning", date_from: "YYYY-MM-DD", part_of_day: "morning | afternoon | evening | any" } },
      "visit.hold": { summary: "Hold a visit. Returns an offer to commit.", params: { slot_id: "from visit.search", customer_first_name: "first name only", issue_summary: "max 140 characters, no address" } },
    },
    humans_only: ["Your home address goes to the technician directly after confirmation"],
    data_policy: "First name and a short issue summary only.",
  },
  "shieldsure": {
    code: "SS", name: "ShieldSure Insurance", category: "insurance",
    tagline: "Car, bike, health and home cover renewals.",
    intents: {
      "renewal.quote": { summary: "Indicative renewal quote", params: { product: "car | bike | health | home", current_expiry: "YYYY-MM-DD", claims_last_year: "yes | no" } },
    },
    humans_only: ["Buying the policy: KYC and payment are completed by the policyholder"],
    data_policy: "No policy numbers, vehicle numbers or ID numbers over this channel.",
  },
  "pulse-fitness": {
    code: "PF", name: "Pulse Fitness", category: "fitness_membership",
    tagline: "Gym and studio memberships.",
    intents: {
      "membership.cancel_quote": { summary: "Quote the terms of cancelling. Returns an offer to commit.", params: { member_first_name: "first name only", effective: "end_of_cycle | immediate" } },
    },
    humans_only: ["Refund disputes"],
    data_policy: "First name only. Membership is matched by the verified principal in a real deployment.",
  },
};

const PRICES = {
  table_hold_per_guest: P(500, 100, 25),
  clinic: { gp: P(800, 250, 150), dentist: P(1200, 350, 200), dermatology: P(1500, 450, 250), physio: P(1000, 300, 180) },
  visit_fee: P(299, 99, 89),
  repair_range: { plumbing: [P(400, 150, 120), P(2500, 600, 450)], electrical: [P(350, 150, 120), P(3000, 700, 500)], ac_service: [P(600, 180, 150), P(4500, 900, 650)], appliance_repair: [P(500, 200, 140), P(6000, 1200, 800)], pest_control: [P(1200, 350, 180), P(4000, 900, 450)], deep_cleaning: [P(3000, 600, 300), P(8000, 1500, 750)] },
  premium: { car: P(14000, 2400, 1900), bike: P(2200, 600, 450), health: P(18000, 4500, 3600), home: P(6000, 900, 1100) },
  early_exit_fee: P(1500, 150, 60),
};

const SENSITIVE = [
  [/\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/, "an Aadhaar-like number"],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/i, "a PAN-like number"],
  [/\b\d{3}-\d{2}-\d{4}\b/, "an SSN-like number"],
  [/\b784-?\d{4}-?\d{7}-?\d\b/, "an Emirates ID-like number"],
  [/\b(?:\d[ -]?){13,19}\b/, "a card-like number"],
  [/\b(otp|cvv|upi pin|password|passcode)\b/i, "a secret or one-time code"],
];

const fail = (code, message) => ({ ok: false, error: { code, message } });
const hash = (s) => crypto.createHash("sha256").update(s).digest();
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (min) => pad(Math.floor(min / 60)) + ":" + pad(min % 60);

export function todayIn(tz, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function checkDate(date, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return "date must be YYYY-MM-DD";
  const d = Date.parse(date + "T00:00:00Z"), t = Date.parse(today + "T00:00:00Z");
  if (Number.isNaN(d)) return "date is not a real date";
  if (d < t) return "date is in the past";
  if (d > t + 60 * 86400000) return "we only take bookings up to 60 days ahead";
  return null;
}

function addDays(date, n) {
  const d = new Date(Date.parse(date + "T00:00:00Z") + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// Deterministic "availability": the same request always sees the same free slots.
function freeSlots(bizId, key, date, centreMin, step, count) {
  const out = [];
  for (let k = -3; k <= 3 && out.length < count; k++) {
    const m = centreMin + k * step;
    if (m < 540 || m > 1290) continue;
    if (hash(bizId + key + date + m)[0] % 4 === 0) continue;
    out.push(m);
  }
  // Closest to the requested time first, so an agent taking the first slot gets the best match.
  return out.sort((a, b) => Math.abs(a - centreMin) - Math.abs(b - centreMin)).slice(0, count);
}

function parseSlot(slotId, code) {
  const m = new RegExp("^" + code + "-([A-Z]{2,4})-(\\d{8})-(\\d{4})$").exec(String(slotId || ""));
  if (!m) return null;
  const date = m[2].slice(0, 4) + "-" + m[2].slice(4, 6) + "-" + m[2].slice(6);
  return { key: m[1], date, min: Number(m[3].slice(0, 2)) * 60 + Number(m[3].slice(2)) };
}

// "Thu 8 Oct" for people; slot ids and offer.start stay ISO for machines.
export function niceDate(date) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

const slotId = (code, key, date, min) => `${code}-${key}-${date.replace(/-/g, "")}-${hhmm(min).replace(":", "")}`;

function makeOffer(bizId, ctx, fields) {
  const biz = BUSINESSES[bizId];
  const offer = {
    offer_id: `${biz.code}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
    business_id: bizId, business_name: biz.name, currency: ctx.currency,
    expires_at: new Date(Date.now() + 20 * 60000).toISOString(), demo: true, ...fields,
  };
  return { ok: true, offer, offer_token: seal("offer", offer) };
}

const firstName = (v) => String(v || "").trim().split(/\s+/)[0].slice(0, 30);

const HANDLERS = {
  "availability.search"(p, ctx) {
    const bad = checkDate(p.date, ctx.today);
    if (bad) return fail("BAD_DATE", bad);
    const [h, m] = String(p.time || "20:00").split(":").map(Number);
    const party = Number(p.party_size);
    if (!(party >= 1 && party <= 12)) return fail("BAD_PARTY", "party_size must be 1 to 12; larger groups are handled by a human");
    const mins = freeSlots("saffron-room", "TB", p.date, (h || 20) * 60 + (m || 0), 30, 3);
    return { ok: true, slots: mins.map((x) => ({ slot_id: slotId("SR", "TB", p.date, x), date: p.date, time: hhmm(x), seating: hash(p.date + x)[1] % 2 ? "terrace" : "indoor" })) };
  },
  "table.hold"(p, ctx) {
    const s = parseSlot(p.slot_id, "SR");
    if (!s) return fail("BAD_SLOT", "unknown slot_id; call availability.search first");
    const party = Number(p.party_size);
    if (!(party >= 1 && party <= 12)) return fail("BAD_PARTY", "party_size must be 1 to 12");
    const amount = PRICES.table_hold_per_guest[ctx.currency] * party;
    return makeOffer("saffron-room", ctx, {
      kind: "table_hold", amount, payment: "refundable card hold",
      summary: `Table for ${party} on ${niceDate(s.date)} at ${hhmm(s.min)}${p.dietary_notes ? ` (${String(p.dietary_notes).slice(0, 60)})` : ""}`,
      start: `${s.date}T${hhmm(s.min)}`, duration_minutes: 120,
      terms: "Hold released if cancelled more than 24 hours ahead.", requires_approval: false,
    });
  },
  "slots.search"(p, ctx) {
    const spec = String(p.specialty || "gp");
    if (!PRICES.clinic[spec]) return fail("BAD_SPECIALTY", "specialty must be gp, dentist, dermatology or physio");
    return multiDaySlots("citycare-clinic", "CC", spec.slice(0, 3).toUpperCase(), p, ctx, 30, { specialty: spec, fee: PRICES.clinic[spec][ctx.currency] });
  },
  "appointment.hold"(p, ctx) {
    const s = parseSlot(p.slot_id, "CC");
    if (!s) return fail("BAD_SLOT", "unknown slot_id; call slots.search first");
    const spec = { GP: "gp", DEN: "dentist", DER: "dermatology", PHY: "physio" }[s.key] || "gp";
    return makeOffer("citycare-clinic", ctx, {
      kind: "appointment", amount: PRICES.clinic[spec][ctx.currency], payment: "consultation fee, charged at the visit",
      summary: `${spec === "gp" ? "GP" : spec[0].toUpperCase() + spec.slice(1)} appointment for ${firstName(p.patient_first_name) || "patient"} on ${niceDate(s.date)} at ${hhmm(s.min)}`,
      start: `${s.date}T${hhmm(s.min)}`, duration_minutes: 30,
      terms: "Free cancellation up to 4 hours before.", requires_approval: false,
    });
  },
  "visit.search"(p, ctx) {
    const svc = String(p.service || "plumbing");
    if (!PRICES.repair_range[svc]) return fail("BAD_SERVICE", "unknown service");
    const [lo, hi] = PRICES.repair_range[svc];
    return multiDaySlots("fixit-home", "FX", svc.slice(0, 3).toUpperCase(), p, ctx, 120, { service: svc, visit_fee: PRICES.visit_fee[ctx.currency], typical_repair_range: [lo[ctx.currency], hi[ctx.currency]] });
  },
  "visit.hold"(p, ctx) {
    const s = parseSlot(p.slot_id, "FX");
    if (!s) return fail("BAD_SLOT", "unknown slot_id; call visit.search first");
    return makeOffer("fixit-home", ctx, {
      kind: "technician_visit", amount: PRICES.visit_fee[ctx.currency], payment: "visit fee, adjusted against the repair bill",
      summary: `Technician visit on ${niceDate(s.date)}, ${hhmm(s.min)} to ${hhmm(s.min + 120)}: ${String(p.issue_summary || "repair").slice(0, 140)}`,
      start: `${s.date}T${hhmm(s.min)}`, duration_minutes: 120,
      terms: "Repairs are quoted on site and need your separate OK.", requires_approval: false,
    });
  },
  "renewal.quote"(p, ctx) {
    const product = String(p.product || "car");
    if (!PRICES.premium[product]) return fail("BAD_PRODUCT", "product must be car, bike, health or home");
    const base = PRICES.premium[product][ctx.currency];
    const factor = p.claims_last_year === "yes" ? 1.12 : 0.9;
    return {
      ok: true, quote_id: `SS-Q${crypto.randomBytes(2).toString("hex").toUpperCase()}`, product, currency: ctx.currency,
      indicative_premium: Math.round(base * factor), no_claim_bonus_applied: p.claims_last_year !== "yes",
      human_required: true,
      next_step: "Buying the policy needs KYC and payment by the policyholder. ShieldSure sends a secure link to the registered mobile number.",
    };
  },
  "membership.cancel_quote"(p, ctx) {
    const immediate = p.effective === "immediate";
    return makeOffer("pulse-fitness", ctx, {
      kind: "membership_cancellation", amount: immediate ? PRICES.early_exit_fee[ctx.currency] : 0,
      payment: immediate ? "early exit fee" : "no fee",
      summary: `Cancel ${firstName(p.member_first_name) || "member"}'s membership ${immediate ? "immediately" : "at the end of the current billing cycle"}`,
      terms: "Cancellation is irreversible. Rejoining later is at current prices.", requires_approval: true,
    });
  },
};

function multiDaySlots(bizId, code, key, p, ctx, step, extra) {
  const from = p.date_from || ctx.today;
  const bad = checkDate(from, ctx.today);
  if (bad) return fail("BAD_DATE", bad);
  const centre = PARTS[p.part_of_day] ?? PARTS.any;
  const slots = [];
  for (let d = 0; d < 4 && slots.length < 4; d++) {
    const date = addDays(from, d);
    for (const m of freeSlots(bizId, key, date, centre, step, 2)) slots.push({ slot_id: slotId(code, key, date, m), date, time: hhmm(m) });
  }
  return { ok: true, ...extra, currency: ctx.currency, slots: slots.slice(0, 4) };
}

// The gateway's own structured fields (slot ids, dates) are digit-heavy but never personal data.
const STRUCTURED = new Set(["slot_id", "date", "date_from", "current_expiry", "time", "party_size"]);

function findSensitive(value) {
  const free = Object.fromEntries(Object.entries(value || {}).filter(([k]) => !STRUCTURED.has(k)));
  const text = JSON.stringify(free);
  for (const [re, label] of SENSITIVE) if (re.test(text)) return label;
  return null;
}

// ctx: { currency, today, principal, agent_id }
export function handle(bizId, intent, params, ctx) {
  const biz = BUSINESSES[bizId];
  if (!biz) return fail("UNKNOWN_BUSINESS", "no such business");
  if (!biz.intents[intent]) return fail("UNSUPPORTED_INTENT", `${biz.name} supports: ${Object.keys(biz.intents).join(", ")}`);
  const leaked = findSensitive(params);
  if (leaked) return fail("SENSITIVE_DATA_REJECTED", `Request refused: it contains ${leaked}. This channel never accepts IDs, card numbers or secrets.`);
  return HANDLERS[intent](params || {}, ctx);
}

export function commit(offerToken, ctx) {
  const offer = unseal("offer", offerToken);
  if (!offer) return fail("BAD_OFFER", "offer token is invalid or was altered");
  if (Date.parse(offer.expires_at) < Date.now()) return fail("OFFER_EXPIRED", "offer expired; request a new one");
  const receipt = signReceipt({
    receipt_id: `rcpt_${offer.offer_id}`, offer_id: offer.offer_id, business_id: offer.business_id,
    business_name: offer.business_name, summary: offer.summary, amount: offer.amount, currency: offer.currency,
    payment: offer.payment, start: offer.start, issued_at: new Date().toISOString(),
    principal: ctx.principal || "anonymous visitor", agent: ctx.agent_id || "unidentified agent", demo: true,
  });
  return { ok: true, status: "confirmed", receipt };
}

export function agentCard(bizId, origin) {
  const biz = BUSINESSES[bizId];
  if (!biz) return null;
  return {
    note: "Illustrative A2A-style agent card for a fictional demo business. Nothing booked here is real.",
    id: bizId, name: biz.name, category: biz.category, description: biz.tagline,
    endpoint: `${origin}/gateway/${bizId}`,
    intents: { ...biz.intents, "offer.commit": { summary: "Commit an offer. Returns a signed receipt.", params: { offer_token: "from a hold or quote intent" } } },
    accepts: { agent_identity: ["unsigned (demo)", "web-bot-auth (planned)"], payment: ["simulated card hold"], cities: Object.keys(CITIES) },
    humans_only: biz.humans_only, data_policy: biz.data_policy,
    receipts: { alg: "Ed25519", kid: keyId, public_jwk: publicJwk, verify: `${origin}/api/verify` },
    demo: true,
  };
}

export function directory(origin) {
  return {
    name: "Friday Musings demo gateways",
    note: "Fictional businesses that answer AI agents. Point your own agent at any card below.",
    businesses: Object.entries(BUSINESSES).map(([id, b]) => ({ id, name: b.name, category: b.category, card: `${origin}/gateway/${id}/agent-card.json` })),
    receipts: { alg: "Ed25519", kid: keyId, public_jwk: publicJwk },
  };
}
