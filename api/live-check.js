// GET /api/live-check → one cached call to each live source, so a deploy can be checked without
// running the model. Results are cached in lib/live.js, so this can't be used to hammer upstreams.

import { weather, places, fx, flightConfigured } from "../lib/live.js";
import { todayIn } from "../lib/gateway.js";

async function probe(fn) {
  try {
    const out = await fn();
    return out.error ? { ok: false, error: out.error } : { ok: true, sample: out };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export default async function handler(req, res) {
  const today = todayIn("Asia/Kolkata");
  const [w, p, r] = await Promise.all([
    probe(() => weather({ place: "Delhi", days: 1 }, { today })),
    probe(() => places({ what: "restaurant", area: "Bandra West" }, { cityLabel: "Mumbai", currency: "INR" })),
    probe(() => fx({ amount: 100, from: "AED", to: "INR" })),
  ]);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.end(JSON.stringify({ weather: w, places: p, fx: r, flight: { connected: flightConfigured() } }, null, 2));
}
