// POST /gateway/:biz  (rewritten to /api/gateway?biz=:biz)
//
// The demo businesses' public agent endpoint. Any agent can call it:
//   { "intent": "availability.search", "params": {...}, "city": "mumbai" }
//   { "intent": "offer.commit", "offer_token": "..." }

import { CITIES, handle, commit, todayIn } from "../lib/gateway.js";
import { checkLimit } from "../lib/limits.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Agent-Id");
}

export default async function handler(req, res) {
  cors(res);
  const send = (status, obj) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj, null, 2));
  };
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") return send(405, { error: "POST a JSON body with an intent. GET the agent card for the list of intents." });
  const limit = await checkLimit(req, "gateway");
  if (!limit.ok) return send(429, { error: limit.message });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== "object") return send(400, { error: "Body must be JSON." });

  const bizId = String(req.query?.biz || "");
  const city = CITIES[body.city] || CITIES.mumbai;
  const ctx = {
    currency: city.currency, today: todayIn(city.tz),
    principal: "external caller", agent_id: String(req.headers["x-agent-id"] || "unidentified agent").slice(0, 80),
  };
  const out = body.intent === "offer.commit" ? commit(body.offer_token, ctx) : handle(bizId, String(body.intent || ""), body.params, ctx);
  return send(out.ok ? 200 : 400, { ...out, agent_verification: "unsigned (demo accepts)", demo: true });
}
