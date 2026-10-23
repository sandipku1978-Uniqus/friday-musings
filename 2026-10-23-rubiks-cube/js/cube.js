// Browser twin of cube.py + the video's 7-step method, as a solver that works on any scramble.
// Same conventions as cube.py: x right, y up, z towards the viewer; yellow top, white bottom,
// green front, orange right, red left, blue back; `y` spins the whole cube the same way as U.
// The state is 54 sticker colors, one per slot (cubie position + outward normal).

export const NORMALS = { R: [1, 0, 0], L: [-1, 0, 0], U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1] };
export const FACE_COLOR = { U: "Y", D: "W", F: "G", B: "B", R: "O", L: "R" };

// Recipes: kept identical to stages.py (tests/rubiks.test.js checks this).
export const TRICK = "R U R' U'";
export const MID_RIGHT = "U R U' R' U' F' U F";
export const MID_LEFT = "U' L' U L U F U' F'";
export const YCROSS = "F R U R' U' F'";
export const MATCH = "R U R' U R U2 R' U";
export const CORNERS_HOME = "U R U' L' U R' U' L";
export const TWIST = "R' D' R D";

export const WORDS = {
  R: "Right UP", "R'": "Right DOWN", R2: "Right twice",
  "L'": "Left UP", L: "Left DOWN", L2: "Left twice",
  U: "Top LEFT", "U'": "Top RIGHT", U2: "Top twice",
  F: "Front RIGHT", "F'": "Front LEFT", F2: "Front twice",
  D: "Bottom RIGHT", "D'": "Bottom LEFT", D2: "Bottom twice",
  B: "Back turn", "B'": "Back turn", B2: "Back twice",
  y: "Spin cube LEFT", "y'": "Spin cube RIGHT", y2: "Spin cube twice",
};

const key = (v) => v.join(",");
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Integer rotation about an axis by `quarter` quarter turns, same sign as cube.py rot_matrix(n, -pi/2 * turns).
export function rotMatrix(axis, angle) {
  const [x, y, z] = axis, c = Math.cos(angle), s = Math.sin(angle), C = 1 - c;
  return [
    [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
  ];
}
export const mul = (M, v) => [dot(M[0], v), dot(M[1], v), dot(M[2], v)];

export const SLOTS = [];
const SLOT_INDEX = new Map();
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
  if (!x && !y && !z) continue;
  for (const f of "RLUDFB") {
    const n = NORMALS[f];
    if (dot(n, [x, y, z]) === 1) { SLOT_INDEX.set(key([x, y, z]) + "|" + key(n), SLOTS.length); SLOTS.push({ p: [x, y, z], n, face: f }); }
  }
}
export const slotOf = (p, n) => SLOT_INDEX.get(key(p) + "|" + key(n));

export function parse(seq) { return Array.isArray(seq) ? seq.slice() : seq.split(/\s+/).filter(Boolean); }
export function moveSpec(m) {
  const turns = m.endsWith("'") ? -1 : m.endsWith("2") ? 2 : 1;
  return { axis: m[0] === "y" ? [0, 1, 0] : NORMALS[m[0]], turns, whole: m[0] === "y" };
}
export const inLayer = (m, p) => { const s = moveSpec(m); return s.whole || dot(p, s.axis) === 1; };

// next[j] = state[SRC[m][j]]
const SRC = {};
for (const f of "RLUDFBy") for (const sfx of ["", "'", "2"]) {
  const m = f + sfx, { axis, turns } = moveSpec(m);
  const R = rotMatrix(axis, (-Math.PI / 2) * turns).map((r) => r.map(Math.round));
  const src = SLOTS.map((_, i) => i);
  SLOTS.forEach((s, i) => { if (inLayer(m, s.p)) src[slotOf(mul(R, s.p), mul(R, s.n))] = i; });
  SRC[m] = src;
}

export function invert(seq) {
  return parse(seq).reverse().map((m) => (m.endsWith("'") ? m[0] : m.endsWith("2") ? m : m + "'")).join(" ");
}

export class Cube {
  constructor(state) { this.s = state ? state.slice() : SLOTS.map((sl) => FACE_COLOR[sl.face]); }
  copy() { return new Cube(this.s); }
  apply(m) { const src = SRC[m]; if (!src) throw new Error("unknown move " + m); const o = this.s; this.s = src.map((i) => o[i]); return this; }
  applySeq(seq) { for (const m of parse(seq)) this.apply(m); return this; }
  at(p, n) { return this.s[slotOf(p, n)]; }
  center(n) { return this.at(n, n); }
  stickers(p) { return SLOTS.filter((sl) => key(sl.p) === key(p)).map((sl) => ({ n: sl.n, c: this.at(sl.p, sl.n) })); }
  pieceSolved(p) { return this.stickers(p).every(({ n, c }) => c === this.center(n)); }
  isSolved() { return SLOTS.every((sl, i) => this.s[i] === this.center(sl.n)); }
  key() { return this.s.join(""); }
}

// ---- stage checks (stages.py STAGE) -------------------------------------------------------
export const D_EDGES = [[0, -1, 1], [1, -1, 0], [0, -1, -1], [-1, -1, 0]];
export const D_CORNERS = [[-1, -1, -1], [-1, -1, 1], [1, -1, -1], [1, -1, 1]];
export const MID_EDGES = [[-1, 0, -1], [-1, 0, 1], [1, 0, -1], [1, 0, 1]];
export const U_EDGES = [[0, 1, 1], [1, 1, 0], [0, 1, -1], [-1, 1, 0]];
export const U_CORNERS = [[-1, 1, -1], [-1, 1, 1], [1, 1, -1], [1, 1, 1]];
export const PIECES = SLOTS.reduce((a, s) => (a.some((p) => key(p) === key(s.p)) ? a : [...a, s.p]), []).filter((p) => Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2]) > 1);

const UP = [0, 1, 0];
const allSolved = (c, ps) => ps.every((p) => c.pieceSolved(p));
const yellowEdgesUp = (c) => U_EDGES.every((p) => c.at(p, UP) === c.center(UP));
export function cornerHome(c, p) {
  const need = new Set([c.center([p[0], 0, 0]), c.center([0, 0, p[2]]), c.center(UP)]);
  const has = c.stickers(p).map((s) => s.c);
  return has.every((x) => need.has(x)) && new Set(has).size === 3;
}
export const STAGE = {
  0: () => true,
  1: (c) => allSolved(c, D_EDGES),
  2: (c) => allSolved(c, [...D_EDGES, ...D_CORNERS]),
  3: (c) => allSolved(c, [...D_EDGES, ...D_CORNERS, ...MID_EDGES]),
  4: (c) => STAGE[3](c) && yellowEdgesUp(c),
  5: (c) => STAGE[3](c) && allSolved(c, U_EDGES),
  6: (c) => STAGE[5](c) && U_CORNERS.every((p) => cornerHome(c, p)),
  7: (c) => c.isSolved(),
};
// Finished work each step must hand back intact: pieces completed by the earlier steps.
export const PROTECTED = {
  1: [], 2: D_EDGES, 3: [...D_EDGES, ...D_CORNERS], 4: [...D_EDGES, ...D_CORNERS, ...MID_EDGES],
  5: [...D_EDGES, ...D_CORNERS, ...MID_EDGES], 6: [...D_EDGES, ...D_CORNERS, ...MID_EDGES, ...U_EDGES],
  7: [...D_EDGES, ...D_CORNERS, ...MID_EDGES, ...U_EDGES],
};
export const intactCount = (c, step) => PROTECTED[step].filter((p) => c.pieceSolved(p)).length;
export const piecesHome = (c) => PIECES.filter((p) => c.pieceSolved(p)).length;

// ---- the solver: the video's method, step by step -----------------------------------------
const turn = (f, q) => [[], [f], [f + "2"], [f + "'"]][((q % 4) + 4) % 4];

// Merges neighbors on the same face (U U -> U2, U U' -> nothing) inside one segment.
export function simplify(moves) {
  const out = [];
  for (const m of moves) {
    const q = (x) => (x.endsWith("'") ? 3 : x.endsWith("2") ? 2 : 1);
    const last = out[out.length - 1];
    if (last && last[0] === m[0]) { out.pop(); out.push(...turn(m[0], q(last) + q(m))); } else out.push(m);
  }
  return out;
}

function flowerSearch(c) {
  // One more white petal around yellow (white facing up on a top edge), never losing one. No back-face moves.
  const white = c.center([0, -1, 0]);
  const petals = (x) => U_EDGES.filter((p) => x.at(p, UP) === white).length;
  const goal = petals(c) + 1, faces = "UDRLF", path = [];
  const dfs = (x, depth, lastFace) => {
    if (!depth) return petals(x) >= goal;
    for (const f of faces) {
      if (f === lastFace) continue;
      for (const sfx of ["", "'", "2"]) {
        path.push(f + sfx);
        if (dfs(x.copy().apply(f + sfx), depth - 1, f)) return true;
        path.pop();
      }
    }
    return false;
  };
  for (let d = 1; d <= 7; d++) if (dfs(c, d, "")) return path;
  throw new Error("flower search failed");
}

export function solve(start) {
  const c = start.copy(), segs = [];
  const run = (step, caption, moves, kind = "") => {
    const ms = simplify(parse(moves));
    if (!ms.length) return;
    c.applySeq(ms);
    segs.push({ step, caption, moves: ms, kind });
  };
  const firstOf = (opts, ok) => { for (const o of opts) if (ok(c.copy().applySeq(o))) return o; return null; };
  const spinsAndTops = [];
  for (const u of [0, 1, 2, 3]) for (const y of [0, 1, 2, 3]) spinsAndTops.push([...turn("U", u), ...turn("y", y)]);
  const spins = [0, 1, 2, 3].map((y) => turn("y", y));
  const tops = [0, 1, 2, 3].map((u) => turn("U", u));

  // Step 1: flower, then each petal: top until it matches, front twice, spin to the next.
  for (let guard = 0; guard < 4 && !U_EDGES.every((p) => c.at(p, UP) === c.center([0, -1, 0])); guard++) {
    run(1, "Build the white flower around yellow", flowerSearch(c), "flower");
  }
  for (let i = 0; i < 4; i++) {
    const white = c.center([0, -1, 0]);
    const u = firstOf(tops, (x) => x.at([0, 1, 1], UP) === white && x.at([0, 1, 1], [0, 0, 1]) === x.center([0, 0, 1]));
    if (u === null) throw new Error("petal not found");
    run(1, "Turn the top until the petal matches", u);
    run(1, "Front twice", ["F2"]);
    if (i < 3) run(1, "Spin to the next petal", ["y"]);
  }
  if (!STAGE[1](c)) throw new Error("step 1");

  // Step 2: corner above its home at the top front right, magic trick until it drops in.
  for (let guard = 0; guard < 12 && !STAGE[2](c); guard++) {
    const white = c.center([0, -1, 0]);
    const isWhiteTop = (x) => x.stickers([1, 1, 1]).some((s) => s.c === white) &&
      new Set(x.stickers([1, 1, 1]).map((s) => s.c)).has(x.center([1, 0, 0])) && new Set(x.stickers([1, 1, 1]).map((s) => s.c)).has(x.center([0, 0, 1]));
    const setup = firstOf(spinsAndTops, isWhiteTop);
    if (setup) {
      run(2, "Corner on top, right above its home", setup);
      const t = c.copy();
      let reps = 0;
      while (!t.pieceSolved([1, -1, 1])) { t.applySeq(TRICK); if (++reps > 6) throw new Error("trick loop"); }
      run(2, reps === 1 ? "Magic trick until it drops in" : `Magic trick ${reps} times until it drops in`, Array(reps).fill(TRICK).join(" "), "trick");
    } else {
      const s = firstOf(spins, (x) => !x.pieceSolved([1, -1, 1]));
      run(2, "Corner stuck at the bottom: spin it to the front right", s);
      run(2, "One magic trick brings it up", TRICK, "trick");
    }
  }
  if (!STAGE[2](c)) throw new Error("step 2");

  // Step 3: top edge with no yellow, top turned until its front color matches, then the left or right recipe.
  for (let guard = 0; guard < 12 && !STAGE[3](c); guard++) {
    const yellow = c.center(UP);
    const ready = (x) => {
      const st = x.stickers([0, 1, 1]);
      return st.every((s) => s.c !== yellow) && x.at([0, 1, 1], [0, 0, 1]) === x.center([0, 0, 1]);
    };
    const setup = firstOf(spinsAndTops, ready);
    if (setup) {
      run(3, "Turn the top until the front color matches", setup);
      const right = c.at([0, 1, 1], UP) === c.center([1, 0, 0]);
      run(3, right ? "It goes right: the right recipe" : "It goes left: the left recipe", right ? MID_RIGHT : MID_LEFT, right ? "midright" : "midleft");
    } else {
      run(3, "Edge stuck in the middle row: spin it to the front right", firstOf(spins, (x) => !x.pieceSolved([1, 0, 1])));
      run(3, "Pop it out with the right recipe", MID_RIGHT, "midright");
    }
  }
  if (!STAGE[3](c)) throw new Error("step 3");

  // Step 4: dot, L or line, then front right + magic trick + front left.
  for (let guard = 0; guard < 4 && !STAGE[4](c); guard++) {
    const up = (x) => U_EDGES.filter((p) => x.at(p, UP) === x.center(UP)).map(key).sort().join(" ");
    const line = [key([-1, 1, 0]), key([1, 1, 0])].sort().join(" ");
    const ell = [key([0, 1, -1]), key([-1, 1, 0])].sort().join(" ");
    const n = U_EDGES.filter((p) => c.at(p, UP) === c.center(UP)).length;
    if (n === 2) run(4, "Line it up: L to the back left, line left to right", firstOf(tops, (x) => up(x) === line || up(x) === ell));
    run(4, "Front right, magic trick, front left", YCROSS, "ycross");
  }
  if (!STAGE[4](c)) throw new Error("step 4");

  // Step 5: top until 2 edges match, hold them at the back and right, recipe.
  const matched = (x) => "FRBL".split("").filter((f) => { const n = NORMALS[f]; return x.at([n[0], 1, n[2]], n) === x.center(n); });
  for (let guard = 0; guard < 6 && !STAGE[5](c); guard++) {
    const u = firstOf(tops, (x) => matched(x).length >= 2);
    if (u === null) throw new Error("step 5 no pair");
    run(5, "Turn the top until 2 edges match", u);
    if (STAGE[5](c)) break;
    const m = matched(c).join("");
    if (m === "FB" || m === "RL") { run(5, "The matches are opposite: do it once, then look again", MATCH, "match"); continue; }
    run(5, "Hold the 2 matches at the back and right", firstOf(spins, (x) => matched(x).sort().join("") === "BR"));
    run(5, "Run the recipe", MATCH, "match");
  }
  if (!STAGE[5](c)) run(5, "Turn the top to line it up", firstOf(tops, (x) => STAGE[5](x)));
  if (!STAGE[5](c)) throw new Error("step 5");

  // Step 6: hold a home corner at the top front right, recipe until all 4 are home.
  for (let guard = 0; guard < 6 && !STAGE[6](c); guard++) {
    const anyHome = U_CORNERS.some((p) => cornerHome(c, p));
    if (anyHome) run(6, "Hold a home corner at the top front right", firstOf(spins, (x) => cornerHome(x, [1, 1, 1])));
    run(6, anyHome ? "Run the recipe" : "None home: do it once, then look again", CORNERS_HOME, "home");
  }
  if (!STAGE[6](c)) throw new Error("step 6");

  // Step 7: twist each corner at the top front right until yellow is up; turn only the top in between.
  for (let i = 0; i < 4; i++) {
    const t = c.copy();
    let reps = 0;
    while (t.at([1, 1, 1], UP) !== t.center(UP)) { t.applySeq(TWIST); if (++reps > 6) throw new Error("twist loop"); }
    if (reps) run(7, `Corner ${i + 1}: twist until yellow is on top (${reps === 1 ? "once" : reps + " times"})`, Array(reps).fill(TWIST).join(" "), "twist");
    if (i < 3) run(7, "Turn ONLY the top to bring in the next corner", ["U"]);
  }
  run(7, "Turn the top to finish", firstOf(tops, (x) => x.isSolved()) || []);
  if (!c.isSolved()) throw new Error("step 7");
  return segs;
}

// Face turns, counted the way the 20 is counted (a half turn is one); whole-cube spins are not turns.
export const turnCount = (moves) => moves.filter((m) => m[0] !== "y").length;

export function randomScramble(n = 25, rnd = Math.random) {
  const out = [];
  let last = "";
  while (out.length < n) {
    const f = "UDLRFB"[Math.floor(rnd() * 6)];
    if (f === last) continue;
    out.push(f + ["", "'", "2"][Math.floor(rnd() * 3)]);
    last = f;
  }
  return out;
}
