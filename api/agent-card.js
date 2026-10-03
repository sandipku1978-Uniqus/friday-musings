// GET /.well-known/agent-card.json        → directory of demo gateways
// GET /gateway/:biz/agent-card.json        → one business's agent card

import { agentCard, directory } from "../lib/gateway.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=300");
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const origin = `${proto}://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const biz = req.query?.biz ? String(req.query.biz) : "";
  const body = biz ? agentCard(biz, origin) : directory(origin);
  res.statusCode = body ? 200 : 404;
  res.end(JSON.stringify(body || { error: "No such business." }, null, 2));
}
