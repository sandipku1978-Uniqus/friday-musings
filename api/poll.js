// GET /api/poll → the Rubik's Cube musing's "Peer review" tallies. POST /api/poll {q, a} → count one answer and
// return that question's tally. Needs POLL.on (js/poll.js) and the shared store (Vercel KV / Upstash): without
// either, the poll reports enabled: false, counts nothing, and the page keeps the section hidden. Only counts are stored (one Redis hash per question,
// one field per answer); nothing identifies a reader, and answers are checked against the page's own question list.

import { POLL, validAnswer } from "../2026-10-23-rubiks-cube/js/poll.js";
import { kvConfigured, kvPipeline, checkLimit } from "../lib/limits.js";

const key = (qid) => `fm:poll:${POLL.id}:${qid}`;
const toCounts = (flat) => {
  const c = {};
  for (let i = 0; Array.isArray(flat) && i + 1 < flat.length; i += 2) c[flat[i]] = Number(flat[i + 1]) || 0;
  return c;
};

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  const send = (code, body, cache = "no-store") => { res.statusCode = code; res.setHeader("Cache-Control", cache); res.end(JSON.stringify(body)); };
  if (!POLL.on || !kvConfigured) return send(200, { enabled: false });

  if (req.method === "GET") {
    const out = await kvPipeline(POLL.questions.map((q) => ["HGETALL", key(q.id)]));
    if (!out) return send(200, { enabled: false });
    const counts = Object.fromEntries(POLL.questions.map((q, i) => [q.id, toCounts(out[i])]));
    return send(200, { enabled: true, min: POLL.min, counts }, "public, max-age=0, s-maxage=10");
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const { q, a } = body || {};
    if (!validAnswer(q, a)) return send(400, { error: "Unknown question or answer." });
    const limit = await checkLimit(req, "poll");
    if (!limit.ok) return send(429, { error: "Too many answers from your network this hour. Please try again later." });
    const out = await kvPipeline([["HINCRBY", key(q), a, "1"], ["HGETALL", key(q)]]);
    if (!out) return send(503, { error: "The tally is unavailable just now." });
    return send(200, { enabled: true, min: POLL.min, q, counts: toCounts(out[1]) });
  }

  res.setHeader("Allow", "GET, POST");
  return send(405, { error: "Method not allowed." });
}
