import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  Cube, solve, randomScramble, STAGE, PROTECTED, intactCount, turnCount, invert, parse,
  TRICK, MID_RIGHT, MID_LEFT, YCROSS, MATCH, CORNERS_HOME, TWIST, slotOf, D_EDGES, D_CORNERS, MID_EDGES, U_EDGES,
} from "../2026-10-23-rubiks-cube/js/cube.js";
import { STEPS } from "../2026-10-23-rubiks-cube/js/steps.js";
import { gridSlot, tensionCutoff, BPM, BAR, EIGHTH, SIXTEENTH, LEVEL } from "../2026-10-23-rubiks-cube/js/sound.js";
import { certFacts, cleanInitials, PAGE_URL } from "../2026-10-23-rubiks-cube/js/cert.js";

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

test("step 7's low point on the example cube: 2 of 16 pieces intact, reached mid-step (where the page stops)", () => {
  const ex = read("js/app.js").match(/const EXAMPLE = "([^"]+)"/)[1];
  const start = new Cube().applySeq(ex), segs = solve(start), c = start.copy();
  segs.filter((s) => s.step < 7).forEach((s) => c.applySeq(s.moves));
  const moves = segs.filter((s) => s.step === 7).flatMap((s) => s.moves);
  let min = PROTECTED[7].length, at = -1, i = 0;
  for (const m of moves) {
    c.apply(m);
    if (m[0] !== "y") i++;
    if (intactCount(c, 7) < min) { min = intactCount(c, 7); at = i; }
  }
  assert.equal(PROTECTED[7].length, 16);
  assert.equal(min, 2, "the low point the page, the review notes and the certificate quote");
  assert.ok(at > 0 && at < turnCount(moves), "the stop falls inside the step, before the recipe hands work back");
});

test("soundtrack: 124 BPM grid, and cube turns land on it even when frames arrive late", () => {
  assert.equal(BPM, 124);
  assert.ok(Math.abs(BAR - 4 * 60 / 124) < 1e-12 && Math.abs(EIGHTH - BAR / 8) < 1e-12 && Math.abs(SIXTEENTH - BAR / 16) < 1e-12);
  for (const step of [EIGHTH, SIXTEENTH]) {
    let t = 0.437, frames = 7;
    const t0 = 0.05;
    for (let i = 0; i < 200; i++) {
      const { wait, dur } = gridSlot(t, t0, step);
      assert.ok(wait >= 0 && wait < step && dur > 0 && dur <= step + 1e-12);
      const land = t + wait + dur;
      const off = Math.abs(((land - t0) / step) - Math.round((land - t0) / step)) * step;
      assert.ok(off < 1e-9, `turn ${i} lands ${off}s off the grid`);
      frames = (frames * 31 + 11) % 17;
      t = land + frames / 1000; // the next turn starts up to 16 ms late, like a requestAnimationFrame tick
    }
  }
});

test("soundtrack: tension muffles the mix as finished work leaves its place", () => {
  assert.equal(Math.round(tensionCutoff(0)), 18000);
  assert.equal(Math.round(tensionCutoff(1)), 700);
  for (let x = 0; x < 1; x += 0.125) assert.ok(tensionCutoff(x) > tensionCutoff(x + 0.125));
  assert.ok(tensionCutoff(-1) === tensionCutoff(0) && tensionCutoff(2) === tensionCutoff(1));
  assert.ok(LEVEL > 0 && LEVEL < 1, "output trim stays below unity");
});

test("soundtrack: the first tap on a phone unlocks it (a touch pointerdown is not a gesture)", () => {
  // Browsers only let audio start inside a user activation, and a touch grants one when the finger lifts.
  // Listening to pointerdown alone made phones need a second tap (seen with real touch input in Chrome).
  const events = read("js/app.js").match(/for \(const ev of (\[[^\]]+\])\) document\.addEventListener\(ev, unlockSound/);
  assert.ok(events, "unlockSound is registered on a list of events");
  const list = JSON.parse(events[1]);
  for (const ev of ["pointerup", "touchend", "click", "keydown"]) assert.ok(list.includes(ev), `unlocks on ${ev}`);
});

test("tapping the cube is a tap (autoplay pauses); a drag, a scroll or a long press is not", async () => {
  const { CubeView } = await import("../2026-10-23-rubiks-cube/js/view.js");
  const on = {};
  const canvas = {
    width: 0, height: 0,
    addEventListener: (type, fn) => { on[type] = fn; },
    getContext: () => ({ clearRect() {} }),
    getBoundingClientRect: () => ({ width: 300, height: 300 }),
  };
  globalThis.window = { devicePixelRatio: 1 };
  const clock = performance.now;
  let t = 0;
  performance.now = () => t;
  try {
    const view = new CubeView(canvas);
    let taps = 0;
    view.onTap = () => taps++;
    const press = (x = 150) => on.pointerdown({ clientX: x, clientY: 150, pointerType: "touch" });
    const move = (x, y = 150) => on.pointermove({ clientX: x, clientY: y, pointerType: "touch" });
    press(); t += 120; on.pointerup({});
    assert.equal(taps, 1, "a quick press is a tap");
    press(); move(154, 153); t += 150; on.pointerup({});
    assert.equal(taps, 2, "a few pixels of jitter is still a tap");
    press(); move(200); t += 150; on.pointerup({});
    assert.equal(taps, 2, "a drag turns the cube instead");
    press(); on.pointercancel({}); on.pointerup({});
    assert.equal(taps, 2, "a vertical swipe scrolls the page (pointercancel): not a tap");
    press(); t += 700; on.pointerup({});
    assert.equal(taps, 2, "a long press is not a tap");
  } finally {
    performance.now = clock;
    delete globalThis.window;
  }
});

test("soundtrack: a tap anywhere respects the iPhone silent switch; only the ♪ button asks for playback", () => {
  const snd = read("js/sound.js"), app = read("js/app.js");
  assert.match(snd, /if \(loud && navigator\.audioSession\) navigator\.audioSession\.type = "playback"/);
  assert.equal((snd.match(/audioSession\.type = "playback"/g) || []).length, 1, "playback is set in one place");
  const loudCalls = app.match(/unlockSound\([^)]*true\)/g) || [];
  assert.deepEqual(loudCalls, ["unlockSound(null, true)"], "only one caller asks for playback");
  assert.match(app, /soundBtn\.addEventListener\("click", [^\n]*unlockSound\(null, true\)/, "and it is the ♪ button");
});

test("close certificate: exact wording, initials cleaned, links to the live page", () => {
  const ws = STEPS.map((s) => s.ws);
  const f = certFacts({ total: 164, mode: "example", low7: 2, prot7: 16, workstreams: ws, mine: { tricks: 3, turns: 12 }, initials: "s.k9" });
  assert.equal(f.summary, "7 of 7 workstreams signed off");
  assert.deepEqual(f.lines, ["164 turns on the example cube", "Step 7 low point: 2 of 16 pieces intact", "Handed back: 16 of 16", "Magic trick run by hand: 3 tricks, 12 turns"]);
  assert.equal(f.reviewer, "SK");
  const g = certFacts({ total: 159, mode: "mine", low7: null, prot7: 16, workstreams: ws, mine: { tricks: 1, turns: 4 }, initials: "" });
  assert.equal(g.reviewer, "you");
  assert.deepEqual(g.lines, ["159 turns on my own scramble", "Handed back: 16 of 16", "Magic trick run by hand: 1 trick, 4 turns"]);
  assert.ok(g.share.includes("7 of 7 workstreams signed off in 159 turns") && g.share.length < 280);
  assert.equal(cleanInitials("  ab-cd "), "ABC");
  const og = read("index.html").match(/property="og:url" content="([^"]+)"/)[1];
  assert.equal(PAGE_URL, og, "certificate links to the same URL as the page's og:url");
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
  const files = { "index.html": read("index.html"), "js/steps.js": read("js/steps.js"), "js/app.js": read("js/app.js"), "js/sound.js": read("js/sound.js"), "js/cert.js": read("js/cert.js"), "linkedin_post.md": body };
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
