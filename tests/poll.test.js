// /api/poll against an in-memory stand-in for the Upstash REST API (each test file runs in its own process,
// so switching KV on here does not touch the other tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.KV_REST_API_URL = "https://kv.test";
process.env.KV_REST_API_TOKEN = "test-token";
process.env.POLL_VOTES_PER_HOUR = "5";

const redis = new Map();
const run = ([cmd, k, ...rest]) => {
  switch (cmd) {
    case "INCR": redis.set(k, (Number(redis.get(k)) || 0) + 1); return redis.get(k);
    case "EXPIRE": return 1;
    case "HINCRBY": { const h = redis.get(k) || new Map(); h.set(rest[0], (h.get(rest[0]) || 0) + Number(rest[1])); redis.set(k, h); return h.get(rest[0]); }
    case "HGETALL": { const h = redis.get(k); return h ? [...h].flatMap(([f, v]) => [f, String(v)]) : []; }
    default: throw new Error("unsupported " + cmd);
  }
};
let kvDown = false;
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), "https://kv.test/pipeline");
  assert.equal(init.headers.Authorization, "Bearer test-token");
  if (kvDown) return new Response("down", { status: 500 });
  return Response.json(JSON.parse(init.body).map((c) => ({ result: run(c) })));
};

const { default: handler } = await import("../api/poll.js");
const { POLL, shares, validAnswer } = await import("../2026-10-23-rubiks-cube/js/poll.js");
const shippedOn = POLL.on;
POLL.on = true; // the poll ships switched off; these tests exercise it switched on (same module the API reads)

function call(method, body, ip = "203.0.113.7") {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { resolve({ status: this.statusCode, headers: this.headers, body: JSON.parse(s) }); } };
    handler({ method, body, headers: { "x-forwarded-for": ip }, socket: {} }, res);
  });
}

test("GET starts empty, POST counts one answer and returns that question's tally", async () => {
  const empty = await call("GET");
  assert.equal(empty.body.enabled, true);
  assert.equal(empty.body.min, POLL.min);
  assert.deepEqual(Object.keys(empty.body.counts), POLL.questions.map((q) => q.id));
  assert.match(empty.headers["Cache-Control"], /s-maxage=10/);
  const r = await call("POST", { q: "worst", a: "interco" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.counts, { interco: 1 });
  await call("POST", JSON.stringify({ q: "worst", a: "interco" }), "198.51.100.1"); // raw string bodies are accepted too
  assert.deepEqual((await call("GET")).body.counts.worst, { interco: 2 });
});

test("answers outside the question list are refused, and nothing is stored for them", async () => {
  for (const body of [{ q: "worst", a: "drop table" }, { q: "nope", a: "cash" }, {}, "not json"]) {
    assert.equal((await call("POST", body)).status, 400);
  }
  assert.equal([...redis.keys()].filter((k) => k.startsWith("fm:poll:") && !k.endsWith(":worst")).length, 0);
});

test("one network gets a capped number of answers per hour", async () => {
  const ip = "192.0.2.44";
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await call("POST", { q: "recipes", a: "most" }, ip)).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
});

test("a store outage never breaks the page: GET says disabled, POST says unavailable", async () => {
  kvDown = true;
  assert.deepEqual((await call("GET")).body, { enabled: false });
  assert.equal((await call("POST", { q: "sample", a: "owner" }, "192.0.2.99")).status, 503);
  kvDown = false;
  assert.equal((await call("DELETE")).status, 405);
});

test("percentages are whole numbers that add up to exactly 100, with exact counts behind them", () => {
  const q = POLL.questions[0];
  for (const counts of [{ cash: 1, subledgers: 1, interco: 1 }, { cash: 2, consol: 1 }, { flux: 7 }, { cash: 3, subledgers: 3, interco: 3, accruals: 3, flux: 3, consol: 3, suspense: 3 }]) {
    const { total, rows } = shares(q, counts);
    assert.equal(rows.reduce((a, r) => a + r.pct, 0), 100);
    assert.equal(rows.reduce((a, r) => a + r.count, 0), total);
  }
  assert.equal(shares(q, {}).total, 0);
  assert.ok(validAnswer("sample", "preparer") && !validAnswer("sample", "cash"));
  for (const qq of POLL.questions) assert.ok(qq.options.length >= 4 && qq.text.endsWith("?"));
});

test("poll copy follows the house style", () => {
  const text = fs.readFileSync(new URL("../2026-10-23-rubiks-cube/js/poll.js", import.meta.url), "utf8") +
    fs.readFileSync(new URL("../2026-10-23-rubiks-cube/js/peer.js", import.meta.url), "utf8");
  for (const bad of [/~/, /\babout\b/i, /\bnearly\b/i, /\btoday\b/i, /\bcheap/i, /\bcolour/i]) assert.ok(!bad.test(text), String(bad));
});

test("off for the launch: shipped switched off, and the LinkedIn post does not promise it", () => {
  assert.equal(shippedOn, false, "owner's call: back on with POLL.on = true in js/poll.js, plus the line in the post");
  const post = fs.readFileSync(new URL("../2026-10-23-rubiks-cube/content/linkedin_post.md", import.meta.url), "utf8");
  if (!shippedOn) assert.ok(!/three anonymous questions|compares with the room|peer review/i.test(post), "post mentions the poll while it is off");
});

test("switched off, the poll stays closed even with the store connected: GET says disabled, a POST counts nothing", async () => {
  const cash = () => redis.get("fm:poll:rc1:worst")?.get("cash") ?? 0;
  POLL.on = false;
  try {
    assert.deepEqual((await call("GET")).body, { enabled: false });
    const before = cash();
    assert.deepEqual((await call("POST", { q: "worst", a: "cash" }, "192.0.2.201")).body, { enabled: false });
    assert.equal(cash(), before);
  } finally {
    POLL.on = true;
  }
});
