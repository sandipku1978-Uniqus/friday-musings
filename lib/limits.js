// Rate limits that protect the API bill.
//
// With KV_REST_API_URL / KV_REST_API_TOKEN set (Vercel KV / Upstash), counters are shared across
// all instances. Without them, counters live in this instance's memory: fine for a demo, but each
// cold start resets them, so set the KV variables before posting the link widely.

import { hashId } from "./sign.js";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const memory = new Map();

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
export const LIMITS = {
  runsPerHour: num(process.env.RUNS_PER_HOUR, 6),
  resumesPerHour: num(process.env.RESUMES_PER_HOUR, 40),
  runsPerDay: num(process.env.DAILY_RUN_CAP, 200),
  gatewayPerHour: num(process.env.GATEWAY_CALLS_PER_HOUR, 300),
};

async function incr(key, ttlSeconds) {
  if (KV_URL && KV_TOKEN) {
    try {
      const r = await fetch(`${KV_URL}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify([["INCR", key], ["EXPIRE", key, String(ttlSeconds)]]),
      });
      if (r.ok) {
        const out = await r.json();
        const n = Number(out?.[0]?.result);
        if (Number.isFinite(n)) return n;
      }
      console.error(JSON.stringify({ at: "limits.incr", status: r.status }));
    } catch (err) {
      console.error(JSON.stringify({ at: "limits.incr", error: String(err) }));
    }
  }
  const now = Date.now();
  const hit = memory.get(key);
  if (!hit || hit.until < now) {
    memory.set(key, { n: 1, until: now + ttlSeconds * 1000 });
    return 1;
  }
  hit.n += 1;
  return hit.n;
}

export function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket?.remoteAddress || "unknown";
}

// kind: "run" | "resume" | "gateway". Returns { ok: true } or { ok: false, message }.
export async function checkLimit(req, kind) {
  const who = hashId(clientIp(req));
  const hour = Math.floor(Date.now() / 3600000);
  const perHour = kind === "run" ? LIMITS.runsPerHour : kind === "resume" ? LIMITS.resumesPerHour : LIMITS.gatewayPerHour;
  const n = await incr(`fm:rl:${kind}:${who}:${hour}`, 3600);
  if (n > perHour) {
    return { ok: false, message: kind === "run"
      ? `You've used this hour's ${perHour} runs. The concierge is shared, so please try again in a little while.`
      : "Too many requests from your network this hour. Please try again later." };
  }
  if (kind === "run") {
    const day = new Date().toISOString().slice(0, 10);
    const total = await incr(`fm:rl:day:${day}`, 86400 * 2);
    if (total > LIMITS.runsPerDay) {
      return { ok: false, message: "The concierge has reached today's run limit. It resets at midnight UTC." };
    }
  }
  return { ok: true };
}

// A shared daily budget for a metered upstream API (e.g. flight lookups on a free tier).
export async function consumeDaily(name, max) {
  const day = new Date().toISOString().slice(0, 10);
  return (await incr(`fm:quota:${name}:${day}`, 86400 * 2)) <= max;
}
