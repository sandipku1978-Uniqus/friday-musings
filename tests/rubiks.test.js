import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  Cube, solve, randomScramble, STAGE, PROTECTED, intactCount, turnCount, invert, parse,
  TRICK, MID_RIGHT, MID_LEFT, YCROSS, MATCH, CORNERS_HOME, TWIST, slotOf, D_EDGES, D_CORNERS, MID_EDGES, U_EDGES,
} from "../2026-10-23-rubiks-cube/js/cube.js";
import { STEPS } from "../2026-10-23-rubiks-cube/js/steps.js";

const DIR = new URL("../2026-10-23-rubiks-cube/", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, DIR), "utf8");
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test("recipes match stages.py, the video's source of truth", () => {
  const py = read("stages.py");
  const recipes = { TRICK, MID_RIGHT, MID_LEFT, YCROSS, MATCH, CORNERS_HOME, TWIST };
  for (const [name, seq] of Object.entries(recipes)) {
    const m = py.match(new RegExp(`^${name} = "([^"]+)"`, "m"));
    assert.ok(m, `${name} missing from stages.py`);
    assert.equal(seq, m[1], name);
  }
});

test("direction words match verify.py (where the front stickers go)", () => {
  const follow = (move, p, n) => {
    const c = new Cube();
    const s = slotOf(p, n);
    c.s = c.s.map((_, i) => (i === s ? "X" : "-"));
    c.apply(move);
    return c.s.indexOf("X");
  };
  assert.equal(follow("R", [1, 0, 1], [0, 0, 1]), slotOf([1, 1, 0], [0, 1, 0]), "R = Right UP");
  assert.equal(follow("U", [0, 1, 1], [0, 0, 1]), slotOf([-1, 1, 0], [-1, 0, 0]), "U = Top LEFT");
  assert.equal(follow("D", [0, -1, 1], [0, 0, 1]), slotOf([1, -1, 0], [1, 0, 0]), "D = Bottom RIGHT");
  assert.equal(follow("L'", [-1, 0, 1], [0, 0, 1]), slotOf([-1, 1, 0], [0, 1, 0]), "L' = Left UP");
  assert.ok(new Cube().applySeq(Array(6).fill(TWIST).join(" ")).isSolved(), "twist recipe x6 = back to start");
});

test("the 7-step solver solves 400 random cubes, each step ending on its own goal", () => {
  for (let i = 0; i < 400; i++) {
    const start = new Cube().applySeq(randomScramble(25, rnd));
    const segs = solve(start);
    const c = start.copy();
    for (let k = 1; k <= 7; k++) {
      for (const s of segs.filter((x) => x.step === k)) {
        assert.ok(s.moves.every((m) => m[0] !== "B"), "no back-face moves");
        c.applySeq(s.moves);
      }
      assert.ok(STAGE[k](c), `cube ${i}: step ${k} goal`);
      assert.equal(intactCount(c, k), PROTECTED[k].length, `cube ${i}: step ${k} hands finished work back`);
    }
    assert.ok(c.isSolved());
    assert.ok(segs.every((s) => s.step >= 1 && s.step <= 7 && s.moves.length > 0));
  }
});

test("the page's example cube needs every one of the 7 steps", () => {
  const ex = read("js/app.js").match(/const EXAMPLE = "([^"]+)"/)[1];
  const segs = solve(new Cube().applySeq(ex));
  for (let k = 1; k <= 7; k++) assert.ok(turnCount(segs.filter((s) => s.step === k).flatMap((s) => s.moves)) > 0, `step ${k}`);
});

test("close tracker: one workstream with 4 tasks per step", () => {
  assert.equal(STEPS.length, 7);
  for (const s of STEPS) {
    assert.ok(s.ws && s.ws.length <= 24, s.title);
    assert.equal(s.tasks.length, 4, s.title);
  }
});

test("step 7 on the example cube reopens cash, subledgers, intercompany and flux review, then hands them back", () => {
  const ex = read("js/app.js").match(/const EXAMPLE = "([^"]+)"/)[1];
  const start = new Cube().applySeq(ex), segs = solve(start), c = start.copy();
  segs.filter((s) => s.step < 7).forEach((s) => c.applySeq(s.moves));
  const reopened = new Set();
  for (const m of segs.filter((s) => s.step === 7).flatMap((s) => s.moves)) {
    c.apply(m);
    [[1, D_EDGES], [2, D_CORNERS], [3, MID_EDGES], [5, U_EDGES]].forEach(([w, ps]) => { if (!ps.every((p) => c.pieceSolved(p))) reopened.add(w); });
  }
  assert.deepEqual([...reopened].sort(), [1, 2, 3, 5]);
  assert.ok(c.isSolved());
});

test("3,502 positions can be solved in 3 moves or fewer (half-turn metric)", () => {
  const moves = [..."UDLRFB"].flatMap((f) => [f, f + "'", f + "2"]);
  let frontier = [new Cube()];
  const seen = new Set([frontier[0].key()]);
  for (let d = 1; d <= 3; d++) {
    const next = [];
    for (const c of frontier) for (const m of moves) {
      const n = c.copy().apply(m);
      if (!seen.has(n.key())) { seen.add(n.key()); next.push(n); }
    }
    frontier = next;
  }
  assert.equal(seen.size, 3502);
});

test("the staged demo: the 'solve' is the scramble played backward", () => {
  const scramble = "R U F2";
  assert.ok(new Cube().applySeq(scramble).applySeq(invert(scramble)).isSolved());
  assert.deepEqual(parse(invert(scramble)), ["F2", "U'", "R'"]);
});

test("copy follows the house style", () => {
  const post = read("content/linkedin_post.md");
  const body = post.split(/^---$/m).slice(1).join("---").trim();
  const files = { "index.html": read("index.html"), "js/steps.js": read("js/steps.js"), "js/app.js": read("js/app.js"), "js/sound.js": read("js/sound.js"), "linkedin_post.md": body };
  for (const [name, text] of Object.entries(files)) {
    const visible = text.replace(/<style>[\s\S]*?<\/style>/, "");
    for (const bad of [/~/, /\babout\b/i, /\bnearly\b/i, /\bapproximately\b/i, /\btoday\b/i, /this morning/i, /\bcheap/i, /\bcolour/i, /\bfavour/i]) {
      assert.ok(!bad.test(visible), `${name} contains ${bad}`);
    }
  }
  assert.ok(body.length < 3000, `LinkedIn post is ${body.length} characters`);
  assert.ok(body.includes("https://friday-musings.vercel.app/2026-10-23-rubiks-cube/"), "post links to the page");
  assert.ok(files["index.html"].includes("43,252,003,274,489,856,000") || files["js/app.js"].includes("43,252,003,274,489,856,000"));
});
