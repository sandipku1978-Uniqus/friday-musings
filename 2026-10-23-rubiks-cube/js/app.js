// Page wiring: the workbench (cube, close tracker, 7 steps), autoplay or step by step, the intermission, the close checklist.
import { Cube, solve, randomScramble, intactCount, piecesHome, PROTECTED, turnCount, invert, parse, WORDS, D_EDGES, D_CORNERS, MID_EDGES, U_EDGES } from "./cube.js";
import { CubeView, VIEW_TOP, VIEW_BOTTOM } from "./view.js";
import { STEPS, CHECKS, words } from "./steps.js";
import { Sound } from "./sound.js";

const $ = (s) => document.querySelector(s);
const EXAMPLE = "L2 R U2 B F' B' U R F R2 L2 D' L D' R' D' R F' R F' U' L R2 L B2";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: fine */ } },
};

const view = new CubeView($("#stage"));
const sound = new Sound(store.get("rc-sound") !== "off");
// Cube pieces each workstream owns: when a recipe disturbs them, that workstream is re-testing.
const OWNS = { 1: D_EDGES, 2: D_CORNERS, 3: MID_EDGES, 5: U_EDGES };
const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const S = {
  mode: "example", snaps: [], segs: [], done: 0, playing: false, fast: false, lens: store.get("rc-lens") || "cfo", low: null, cstep: 1, tasks: 0, total: 0,
  // autoplay (default): runs every step and the intermission on its own; pauses on request or while the cube is off screen
  auto: store.get("rc-mode") ? store.get("rc-mode") === "auto" : !reducedMotion, running: false, runId: 0, stepId: 0, paused: false, offscreen: false, waiters: [],
};
const blocked = () => S.paused || S.offscreen;
const gate = () => (blocked() ? new Promise((res) => S.waiters.push(res)) : Promise.resolve());
function release() { if (blocked()) return; const w = S.waiters; S.waiters = []; w.forEach((f) => f()); }
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

function load(scramble, mode) {
  view.cancel();
  S.stepId++;
  sound.stopMusic(0.3);
  const start = new Cube().applySeq(scramble);
  const segs = solve(start);
  const snaps = [null, start.copy()];
  for (let k = 1; k <= 7; k++) {
    const c = snaps[k].copy();
    segs.filter((s) => s.step === k).forEach((s) => c.applySeq(s.moves));
    snaps[k + 1] = c;
  }
  Object.assign(S, { mode, segs, snaps, done: 0, playing: false, low: null, cstep: 1, tasks: 0, total: turnCount(segs.flatMap((s) => s.moves)) });
  view.setCube(snaps[1].copy());
  view.lookAt(VIEW_TOP, 400);
  S.note = mode === "example" ? "" : `Scrambled with ${parse(scramble).length} random turns.`;
  label();
  $("#reviewed").classList.remove("on");
  render();
}

function label() {
  $("#cube-label").textContent = S.mode === "example" ? "Example cube. Yours may look different." : "Your cube. Your scramble.";
  $("#scramble-note").textContent = S.note || "";
}

const stepTurns = (k) => turnCount(S.segs.filter((s) => s.step === k).flatMap((s) => s.moves));

function render() {
  const k = Math.min(S.done + 1, 7), solved = S.done === 7;
  document.querySelectorAll(".dot").forEach((d) => {
    const n = +d.dataset.step;
    d.classList.toggle("done", n <= S.done);
    d.classList.toggle("now", n === S.done + 1);
    d.setAttribute("aria-current", n === S.done + 1 ? "step" : "false");
  });
  const next = $("#next");
  if (S.auto) {
    next.disabled = false;
    next.textContent = S.running ? (S.paused ? "▶ Resume" : "❚❚ Pause") : solved ? "▶ Play again with a new scramble" : S.done === 0 ? "▶ Play the close" : `▶ Play from step ${k}`;
  } else {
    next.disabled = S.playing;
    next.textContent = solved ? "Solved! Scramble a new one" : S.done === 3 && !S.sawInterlude ? "Intermission: who scrambled it?" : `Show me step ${k}`;
  }
  $("#mode-auto").setAttribute("aria-pressed", String(S.auto));
  $("#mode-step").setAttribute("aria-pressed", String(!S.auto));
  $("#i-pause").hidden = !S.running;
  $("#i-pause").textContent = S.paused ? "▶ Resume" : "❚❚ Pause";
  hint();
  $("#replay").disabled = S.playing || S.done === 0;
  counter(view.cube, S.cstep);
  card(solved ? 7 : k, solved || (S.done >= k));
}

// The close tracker: one workstream per step, four tasks that tick as the step plays,
// and signed-off workstreams that flip to re-testing while a recipe disturbs their pieces.
function counter(c, k) {
  const list = $("#ws-list");
  list.innerHTML = "";
  let signed = 0, retesting = [];
  STEPS.forEach((s, i) => {
    const w = i + 1, li = document.createElement("li");
    const isSigned = w <= S.done && !(S.playing && w === k);
    const retest = isSigned && w < k && OWNS[w] && (w !== 5 || S.done >= 5) && !OWNS[w].every((p) => c.pieceSolved(p));
    if (isSigned && !retest) signed++;
    if (retest) retesting.push(s.ws);
    li.className = "ws" + (retest ? " retest" : isSigned ? " signed" : w === k ? " active" : "");
    li.innerHTML = `<span class="ws-n">${retest ? "⟳" : isSigned ? "✓" : w}</span>${s.ws}`;
    list.append(li);
  });
  $("#tr-sum").textContent = `${signed} of 7 signed off`;
  const s = STEPS[k - 1], finished = S.done >= k && !S.playing, n0 = finished ? 4 : S.tasks;
  $("#ws-active").innerHTML = `<div class="ws-title"><span>${k}. ${s.ws}</span><span class="mono">${finished ? "Signed off ✓" : `${n0} of 4`}</span></div>` +
    s.tasks.map((t, i) => `<div class="task${i < n0 ? " done" : ""}${S.justTicked === i ? " just" : ""}"><span class="box"></span><span>${t}</span></div>`).join("") +
    (retesting.length ? `<div class="retest-note">Re-testing: ${retesting.join(", ")}</div>` : "");
  S.justTicked = null;
  const n = PROTECTED[k].length, ok = intactCount(c, k);
  const box = $("#ticks");
  box.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const t = document.createElement("span");
    t.className = "tick" + (i < ok ? " ok" : "");
    t.textContent = i < ok ? "✓" : "·";
    box.append(t);
  }
  $("#intact").textContent = n ? `${ok} of ${n}` : "nothing yet";
  $("#low").textContent = !n ? "Step 1 is the foundation: nothing finished yet." :
    S.low !== null && S.low < n ? `Step ${k}. Lowest point: ${S.low} of ${n}.` : `Step ${k}. Every recipe lifts finished work and puts it back.`;
}

function card(k, finished) {
  const s = STEPS[k - 1], cfo = S.lens === "cfo";
  $("#lens-kid").setAttribute("aria-pressed", String(!cfo));
  $("#lens-cfo").setAttribute("aria-pressed", String(cfo));
  $("#step-no").textContent = `Step ${k} of 7`;
  $("#step-title").textContent = s.title;
  $("#step-head").textContent = cfo ? s.cfoHead : "";
  $("#step-head").hidden = !cfo;
  $("#step-body").textContent = cfo ? s.cfo : s.kid;
  $("#step-recipe").textContent = cfo ? `Protects: ${s.protects}` : `Recipe: ${s.recipe}`;
  $("#step-tip").textContent = cfo ? `On ${S.mode === "example" ? "this" : "your"} cube: ${stepTurns(k)} turns in this step.` : s.tip;
  const r = $("#step-result");
  r.hidden = !finished;
  r.textContent = finished ? `✓ ${s.result}` : "";
}

function ticker(seg, m, i, n) {
  $("#caption").textContent = seg ? seg.caption : "";
  $("#move").textContent = m ? `${m}  ·  ${WORDS[m] || m}` : "";
  $("#count").textContent = n ? `turn ${i} of ${n}` : "";
}

function hint() {
  $("#sound-hint").hidden = !(sound.on && !sound.live && (S.running || S.playing));
}

async function playStep(k) {
  if (S.playing) return false;
  const id = ++S.stepId, mine = () => S.stepId === id;
  S.playing = true; S.low = null; S.cstep = k; S.tasks = 0;
  if (!blocked()) sound.startMusic();
  view.setCube(S.snaps[k].copy());
  S.done = k - 1;
  render();
  await view.lookAt(VIEW_TOP, 450);
  const segs = S.segs.filter((s) => s.step === k), n = stepTurns(k);
  const ms = Math.max(110, Math.min(300, 11000 / Math.max(n, 1))) / (S.fast ? 2 : 1);
  let done = 0;
  for (const seg of segs) {
    ticker(seg, "", done, n);
    const ok = await view.play(seg.moves, {
      ms,
      gate,
      onMove: (_, m) => {
        if (m[0] !== "y") { done++; sound.click(); }
        const t = done >= n ? 4 : Math.min(3, Math.floor((4 * done) / Math.max(n, 1)));
        if (t > S.tasks) { S.tasks = t; S.justTicked = t - 1; sound.tick(); }
        ticker(seg, m, done, n);
        const now = intactCount(view.cube, k);
        S.low = S.low === null ? now : Math.min(S.low, now);
        counter(view.cube, k);
      },
    });
    if (!ok || !mine()) { if (mine()) { S.playing = false; sound.stopMusic(0.3); } return false; }
  }
  if (!mine()) return false;
  S.playing = false;
  S.done = k;
  S.tasks = 4;
  sound.stopMusic();
  if (k < 7) sound.chime();
  ticker(null, "", 0, 0);
  $("#caption").textContent = `✓ ${STEPS[k - 1].result}`;
  if (k <= 2) { $("#caption").textContent += " (bottom view)"; view.lookAt(VIEW_BOTTOM); }
  if (k === 7) finale();
  render();
  return true;
}

// ---- autoplay --------------------------------------------------------------------------------
async function hold(ms, alive) {
  for (let left = S.fast ? ms / 2 : ms; left > 0; left -= 100) {
    await gate();
    if (!alive()) return false;
    await wait(100);
  }
  return alive();
}
const interludeOpen = () => !$("#interlude").hidden;
const readTime = () => Math.max(3200, Math.min(11000, 2600 + 38 * ($("#i-title").textContent + $("#i-body").textContent).length));

async function autoRun() {
  if (S.running) return;
  const my = ++S.runId, alive = () => S.running && S.runId === my;
  S.running = true; S.paused = false;
  render();
  while (alive() && S.done < 7) {
    if (S.done === 3 && !S.sawInterlude) {
      if (!interludeOpen()) interlude(true);
      while (alive() && interludeOpen()) {
        const st = I.stage;
        if (!(await hold(readTime(), alive)) || !interludeOpen()) break;
        if (I.stage === st && !I.busy) await interludeNext();
      }
      continue;
    }
    if (!(await playStep(S.done + 1)) || !alive()) break;
    if (S.done < 7 && !(await hold(1800, alive))) break;
  }
  if (S.runId === my) { S.running = false; S.paused = false; render(); }
}
function stopAuto() { S.running = false; S.runId++; S.paused = false; release(); }
function pause() { S.paused = true; sound.stopMusic(0.3); render(); }
function resume() { S.paused = false; release(); if (S.playing && !blocked()) sound.startMusic(); render(); }

function finale() {
  sound.fanfare();
  $("#reviewed").classList.add("on");
  $("#caption").textContent = `✓ Solved in ${S.total} turns. A computer needs 20 or fewer.`;
}

function jump(k) {
  view.cancel();
  S.stepId++;
  S.playing = false; S.low = null; S.cstep = k; S.tasks = 0;
  sound.stopMusic(0.3);
  S.done = k - 1;
  view.setCube(S.snaps[k].copy());
  view.lookAt(VIEW_TOP, 400);
  ticker(null, "", 0, 0);
  render();
}

// ---- intermission: "Are you watching closely?" --------------------------------------------
const I = { stage: 0, demo: null, scramble: [], saved: null };
function interlude(open) {
  $("#bench").classList.toggle("intermission", open);
  $("#interlude").hidden = !open;
  $("#steps-ui").hidden = open;
  $("#cube-label").textContent = open ? "The presenter’s cube" : "";
  $("#scramble-note").textContent = open ? "Your cube is safe in the drawer." : "";
  if (open) {
    I.saved = view.cube;
    const faces = ["R", "U", "F", "L", "D"].sort(() => Math.random() - 0.5).slice(0, 3);
    const r = faces.map((f) => f + ["", "'", "2"][Math.floor(Math.random() * 3)]);
    I.scramble = r;
    I.demo = new Cube().applySeq(r);
    view.setCube(I.demo);
    view.lookAt(VIEW_TOP, 400);
    I.stage = 0;
    interludeRender();
    if (!S.running) $("#interlude").scrollIntoView({ block: "nearest", behavior: "smooth" });
  } else {
    S.sawInterlude = true;
    label();
    view.setCube(I.saved);
    render();
  }
}

const SCENES = [
  { title: "A presenter says: ‘Watch me solve this in 3 moves.’", body: "The cube on the stage was handed over already scrambled. Roll the tape.", btn: "Roll the demo" },
  { title: "Solved in 3 moves. Applause.", body: "Before anyone signs off, one audit question.", btn: "Who scrambled it?" },
  { title: "The presenter did.", body: "", btn: "You pick the sample" },
  { title: "Your sample: 25 random turns.", body: "Now the presenter runs the same 3-move solve on it.", btn: "Run the 3-move solve" },
  { title: "", body: "", btn: "Back to my cube: step 4" },
];

async function interludeNext() {
  if (I.busy) return;
  I.busy = true;
  const btn = $("#i-next");
  btn.disabled = true;
  const solve3 = invert(I.scramble).split(" ");
  const clicks = { onMove: () => sound.click(), gate };
  if ((I.stage === 0 || I.stage === 2 || I.stage === 3) && !blocked()) sound.startMusic();
  if (I.stage === 0) await view.play(solve3, { ms: 650, ...clicks });
  if (I.stage === 2) await view.play(randomScramble(25), { ms: 70, ...clicks });
  if (I.stage === 3) await view.play(solve3, { ms: 650, ...clicks });
  sound.stopMusic(0.6);
  if (I.stage === 0) sound.chime();
  if (I.stage === 3) sound.retest();
  I.busy = false;
  btn.disabled = false;
  if (I.stage === 4) return interlude(false);
  I.stage++;
  interludeRender();
}

function interludeRender() {
  const sc = SCENES[I.stage], solve3 = invert(I.scramble);
  $("#i-title").textContent = sc.title;
  $("#i-body").innerHTML = "";
  $("#i-next").textContent = sc.btn;
  const p = (html) => { const el = document.createElement("p"); el.innerHTML = html; $("#i-body").append(el); };
  if (sc.body) p(sc.body);
  if (I.stage === 2) {
    p(`Off camera, with 3 turns: <code>${I.scramble.join(" ")}</code>. The ‘solve’ is that scramble played backward: <code>${solve3}</code>.`);
    p(`A cube has <b class="num">43,252,003,274,489,856,000</b> positions. <b class="num">3,502</b> of them can be solved in 3 moves or fewer. The demo only works on a sample the presenter picked.`);
  }
  if (I.stage === 4) {
    $("#i-title").textContent = `Not solved. ${piecesHome(view.cube)} of 20 pieces home.`;
    p(`<b>Audit lens:</b> never test a control on a sample the preparer picked. A walkthrough the preparer stages is a three-move solve.`);
    p(`<b>And the other trap:</b> a computer can solve any position in <b class="num">20</b> moves or fewer. The seven steps take your workbench cube <b class="num">${S.total}</b> turns (a half turn counts as one, the same way the 20 is counted). Nobody runs the 20-move version from memory every month. Optimal is for computers; repeatable is for teams.`);
  }
}

// ---- close checklist ------------------------------------------------------------------------
function checklist() {
  const saved = (store.get("rc-checks") || "").split("").map((x) => x === "1");
  const list = $("#checks");
  CHECKS.forEach((text, i) => {
    const li = document.createElement("li");
    const id = `chk${i}`;
    li.innerHTML = `<input type="checkbox" id="${id}"><label for="${id}"><span class="ck-step">${i < 7 ? "Step " + (i + 1) + " · " + STEPS[i].title : "Intermission"}</span>${text}</label>`;
    const box = li.querySelector("input");
    box.checked = !!saved[i];
    box.addEventListener("change", score);
    list.append(li);
  });
  score();
}
function score() {
  const boxes = [...document.querySelectorAll("#checks input")], n = boxes.filter((b) => b.checked).length;
  store.set("rc-checks", boxes.map((b) => (b.checked ? 1 : 0)).join(""));
  $("#score").textContent = `${n} of ${boxes.length}`;
  $("#verdict").textContent =
    n === boxes.length ? "Solved. Frame it and send it to your audit committee chair." :
    !boxes[0].checked ? "Start with the white cross. Everything else stands on it." :
    n >= 5 ? "The first layers hold. The last layer is where recipes beat heroics." :
    "Layer by layer, in order. Tick the next one before the one after it.";
}

// ---- wiring ---------------------------------------------------------------------------------
$("#next").addEventListener("click", () => {
  if (S.auto) {
    if (S.running) return S.paused ? resume() : pause();
    if (S.done === 7) load(randomScramble(25).join(" "), "mine");
    return autoRun();
  }
  if (S.done === 7) return load(randomScramble(25).join(" "), "mine");
  if (S.done === 3 && !S.sawInterlude) return interlude(true);
  playStep(S.done + 1);
});
const restart = (fn) => { stopAuto(); fn(); if (S.auto) autoRun(); };
$("#replay").addEventListener("click", () => (S.auto ? restart(() => jump(Math.max(1, S.done))) : playStep(Math.max(1, S.done))));
$("#scramble").addEventListener("click", () => restart(() => load(randomScramble(25).join(" "), "mine")));
$("#example").addEventListener("click", () => restart(() => load(EXAMPLE, "example")));
["auto", "step"].forEach((m) => $("#mode-" + m).addEventListener("click", () => {
  S.auto = m === "auto";
  store.set("rc-mode", m);
  if (S.auto) autoRun(); else { stopAuto(); render(); }
}));
$("#i-pause").addEventListener("click", () => (S.paused ? resume() : pause()));
// Sound needs a gesture: the first tap or key press anywhere unlocks it, and the loop joins in if the cube is moving.
const unlockSound = () => {
  if (!sound.unlock(true)) return;
  const go = () => { if (S.playing && !blocked()) sound.startMusic(); hint(); };
  sound.ctx.state === "running" ? go() : sound.ctx.resume().then(go, () => {});
};
document.addEventListener("pointerdown", unlockSound, { passive: true });
document.addEventListener("keydown", unlockSound);
// Autoplay starts when the cube is well in view, and waits while it is scrolled fully out of view.
if (typeof IntersectionObserver === "function") {
  new IntersectionObserver(([e]) => {
    S.offscreen = e.intersectionRatio === 0;
    if (S.offscreen) sound.stopMusic(0.3); else { release(); if (S.playing && !blocked()) sound.startMusic(); }
    if (e.intersectionRatio >= 0.6 && S.auto && !S.started) { S.started = true; autoRun(); }
  }, { threshold: [0, 0.6] }).observe($("#stage"));
}
$("#speed").addEventListener("click", (e) => { S.fast = !S.fast; e.currentTarget.textContent = S.fast ? "Speed 2×" : "Speed 1×"; e.currentTarget.setAttribute("aria-pressed", String(S.fast)); });
const soundBtn = $("#sound");
const soundLabel = () => { soundBtn.textContent = sound.on ? "♪ On" : "♪ Off"; soundBtn.setAttribute("aria-pressed", String(sound.on)); };
soundBtn.addEventListener("click", () => { sound.setOn(!sound.on); store.set("rc-sound", sound.on ? "on" : "off"); if (sound.on) { sound.unlock(); sound.tick(); } soundLabel(); });
soundLabel();
// Desktop: the tracker sits beside the cube, above the step card. Phone: under the cube.
const wide = matchMedia("(min-width: 900px)");
const placeTracker = () => (wide.matches ? $(".bench-side").prepend($("#tracker")) : $(".pin").after($("#tracker")));
wide.addEventListener ? wide.addEventListener("change", placeTracker) : wide.addListener(placeTracker);
placeTracker();
$("#flip").addEventListener("click", () => view.lookAt(view.pitch > 0 ? VIEW_BOTTOM : VIEW_TOP));
document.querySelectorAll(".dot").forEach((d) => d.addEventListener("click", () => restart(() => jump(+d.dataset.step))));
$("#intermission-dot").addEventListener("click", () => restart(() => { jump(4); S.sawInterlude = false; interlude(true); }));
["kid", "cfo"].forEach((l) => $("#lens-" + l).addEventListener("click", () => { S.lens = l; store.set("rc-lens", l); render(); }));
$("#i-next").addEventListener("click", interludeNext);
$("#i-skip").addEventListener("click", () => { if (!I.busy) interlude(false); });

$("#kid-steps").innerHTML = STEPS.map((s, i) => `<li><b>${i + 1}. ${s.title}.</b> ${s.kid} <span class="recipe">${s.recipe}</span></li>`).join("");
$("#trick-words").textContent = words("R U R' U'");
checklist();
load(EXAMPLE, "example");
