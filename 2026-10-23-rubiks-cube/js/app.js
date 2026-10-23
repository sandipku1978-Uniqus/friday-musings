// Page wiring: the workbench (cube, close tracker, 7 steps), autoplay or step by step, the intermission, the close checklist.
import { Cube, solve, randomScramble, intactCount, piecesHome, PROTECTED, turnCount, invert, parse, WORDS, TRICK, D_EDGES, D_CORNERS, MID_EDGES, U_EDGES } from "./cube.js";
import { CubeView, VIEW_TOP, VIEW_BOTTOM } from "./view.js";
import { STEPS, CHECKS, words } from "./steps.js";
import { Sound, gridSlot, BEAT, EIGHTH, SIXTEENTH, BAR } from "./sound.js";
import { certFacts, drawCert, cleanInitials, PAGE_URL } from "./cert.js";

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
  lowBy: {}, mine: null, certVer: 0,
};
const blocked = () => S.paused || S.offscreen;
const gate = () => (blocked() ? new Promise((res) => S.waiters.push(res)) : Promise.resolve());
function release() { if (blocked()) return; const w = S.waiters; S.waiters = []; w.forEach((f) => f()); }
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
// Music plays while a step runs, all through autoplay (between steps and in the intermission), during the
// intermission demo, and for 4 s after a step in step-by-step mode so quick clicks keep the groove going.
const musicWanted = () => !blocked() && (S.playing || S.running || S.demo || Date.now() < (S.grace || 0));
function syncMusic(fade) { if (musicWanted()) sound.startMusic(); else sound.stopMusic(fade); }
// Each turn lands on the music's grid: eighth notes at 1x, sixteenths at 2x. Its click is scheduled on the audio
// clock for the landing beat, so the sound is exactly on time and the picture lands within a frame of it.
// Without music, the cube keeps the same rhythm and clicks when each turn lands.
const onGrid = (step) => async (m) => {
  const extra = m.endsWith("2") ? step : 0, g = sound.grid();
  if (!g) { S.clickOnLand = true; return 1000 * (step + extra); }
  S.clickOnLand = false;
  const slot = gridSlot(g.now, g.t0, step);
  if (m[0] !== "y") sound.click(g.now + slot.wait + slot.dur + extra);
  if (slot.wait > 0) await wait(slot.wait * 1000);
  return 1000 * (slot.dur + extra);
};
const onBeat = (m) => onGrid(S.fast ? SIXTEENTH : EIGHTH)(m);

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
  S.lowBy = {}; S.mine = null; S.certVer++;
  $("#cert").hidden = true;
  label();
  reviewedBox(false);
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
  sound.setTension(0);
  syncMusic();
  view.setCube(S.snaps[k].copy());
  S.done = k - 1;
  render();
  await view.lookAt(VIEW_TOP, 450);
  const segs = S.segs.filter((s) => s.step === k), n = stepTurns(k), prot = PROTECTED[k].length;
  let done = 0, cur = null;
  const onMove = (_, m) => {
    if (m[0] !== "y") { done++; if (S.clickOnLand) sound.click(); }
    const t = done >= n ? 4 : Math.min(3, Math.floor((4 * done) / Math.max(n, 1)));
    if (t > S.tasks) { S.tasks = t; S.justTicked = t - 1; sound.tick(); }
    ticker(cur, m, done, n);
    const now = intactCount(view.cube, k);
    S.low = S.low === null ? now : Math.min(S.low, now);
    if (prot) sound.setTension(1 - now / prot);
    counter(view.cube, k);
  };
  for (const seg of segs) {
    cur = seg;
    ticker(seg, "", done, n);
    // the first corner of step 2 is the reader's: they run the magic trick themselves
    if (k === 2 && seg.kind === "trick" && !S.ytOffered) {
      S.ytOffered = true;
      const how = await yourTurn(onMove, mine);
      if (how === "abort" || !mine()) { if (mine()) { S.playing = false; syncMusic(0.3); } return false; }
      if (how === "done") continue;
    }
    const ok = await view.play(seg.moves, { timing: onBeat, gate, onMove });
    if (!ok || !mine()) { if (mine()) { S.playing = false; syncMusic(0.3); } return false; }
  }
  if (!mine()) return false;
  S.playing = false;
  S.done = k;
  S.tasks = 4;
  S.lowBy[k] = S.low;
  sound.setTension(0);
  if (!S.running && k < 7) { S.grace = Date.now() + 4000; setTimeout(() => syncMusic(), 4100); }
  syncMusic();
  if (k < 7) sound.chime();
  ticker(null, "", 0, 0);
  $("#caption").textContent = `✓ ${STEPS[k - 1].result}`;
  if (k <= 2) { $("#caption").textContent += " (bottom view)"; view.lookAt(VIEW_BOTTOM); }
  if (k === 7) finale();
  render();
  return true;
}

// ---- autoplay --------------------------------------------------------------------------------
async function hold(ms, alive, scaled = true) {
  for (let left = scaled && S.fast ? ms / 2 : ms; left > 0; left -= 100) {
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
    // the next step starts on a downbeat (at least one beat after the sign-off chime)
    const bar = sound.untilBar();
    if (S.done < 7 && !(await hold(bar === null ? 1800 : bar * 1000, alive, bar === null))) break;
  }
  if (S.runId === my) { S.running = false; S.paused = false; render(); syncMusic(); }
}
function stopAuto() { S.running = false; S.runId++; S.paused = false; release(); syncMusic(0.3); }
function pause() { S.paused = true; syncMusic(0.3); render(); }
function resume() { S.paused = false; release(); syncMusic(); render(); }

function finale() {
  sound.fanfare();
  sound.stopMusic(2 * BAR);
  reviewedBox(true);
  showCert();
  $("#caption").textContent = `✓ Solved in ${S.total} turns. A computer needs 20 or fewer.`;
}

function jump(k) {
  view.cancel();
  S.stepId++;
  S.playing = false; S.low = null; S.cstep = k; S.tasks = 0;
  sound.setTension(0);
  syncMusic(0.3);
  S.done = k - 1;
  view.setCube(S.snaps[k].copy());
  view.lookAt(VIEW_TOP, 400);
  ticker(null, "", 0, 0);
  render();
}

// ---- "Your turn": the reader runs the magic trick at the first corner of step 2 -----------------------
// Taps land on the beat and the order is enforced, because it is a recipe. Repeating it until the corner drops in
// takes exactly the tricks the solver planned, so the cube ends where the rest of the step expects it.
// Autoplay waits 8 s for a first tap (then plays the corner itself) and 12 s between taps (then finishes the trick).
const RECIPE = parse(TRICK), HOME = [1, -1, 1];
function yourTurn(onMove, mine) {
  const pad = $("#yt"), btns = [...pad.querySelectorAll("[data-m]")];
  let next = 0, tapped = 0, played = 0, byHand = 0, idle = 0, settled = false, locked = false, won = false, chain = Promise.resolve();
  const limit = () => (tapped ? 12000 : 8000);
  const show = (msg) => {
    btns.forEach((b) => { b.classList.toggle("next", !locked && b.dataset.m === RECIPE[next]); b.disabled = locked; });
    $("#yt-count").textContent = locked ? "" : `Trick ${Math.floor(tapped / 4) + 1} · move ${next + 1} of 4`;
    if (msg) $("#yt-msg").textContent = msg;
  };
  pad.hidden = false;
  $("#yt-bar").hidden = !S.running;
  $("#caption").textContent = "Your turn: magic trick until it drops in";
  show(`Drop this corner in. Say it out loud: ${words(TRICK)}.`);
  return new Promise((resolve) => {
    const finish = (how) => {
      if (settled) return;
      settled = true; clearInterval(timer); pad.hidden = true; S.yt = null;
      if (how === "done" && byHand >= 4) S.mine = { tricks: Math.floor(byHand / 4), turns: byHand };
      resolve(how);
    };
    const succeed = async (mine_) => {
      if (won) return;
      won = true; locked = true; show(mine_ ? "Dropped in! That is the recipe: no talent needed." : "Dropped in. Same recipe, run for you.");
      sound.chime();
      await wait(1400);
      finish("done");
    };
    const play = async (m, hand) => {
      if (settled || !mine()) { finish("abort"); return false; }
      const ok = await view.play([m], { timing: onBeat, gate, onMove });
      if (!ok || !mine()) { finish("abort"); return false; }
      played++; if (hand) byHand++;
      if (played % 4 === 0 && view.cube.pieceSolved(HOME)) { await succeed(hand); return false; }
      return true;
    };
    const finishForMe = () => {
      if (locked) return;
      if (!tapped) return finish("auto"); // nothing done yet: the step plays this corner as planned
      locked = true; show("Finishing the trick for you.");
      const rest = RECIPE.slice(next);
      chain = chain.then(async () => {
        for (const m of rest) if (!(await play(m, false))) return;
        while (!settled && !view.cube.pieceSolved(HOME)) for (const m of RECIPE) if (!(await play(m, false))) return;
        await succeed(false);
      });
    };
    S.yt = {
      tap(m, el) {
        if (locked || settled) return;
        idle = 0;
        if (m !== RECIPE[next]) {
          el.classList.remove("nope"); void el.offsetWidth; el.classList.add("nope");
          sound.retest();
          show(`The recipe says ${WORDS[RECIPE[next]]} next.`);
          return;
        }
        next = (next + 1) % 4; tapped++;
        show(next === 0 ? "One trick done. Corner home yet? If not, again." : "");
        chain = chain.then(() => play(m, true));
      },
      skip: finishForMe,
    };
    const timer = setInterval(() => {
      if (settled) return;
      if (!mine()) return finish("abort");
      const bar = $("#yt-timer");
      if (!S.running || locked) { bar.style.transform = "scaleX(1)"; return; }
      if (blocked()) return;
      idle += 100;
      bar.style.transform = `scaleX(${Math.max(0, 1 - idle / limit())})`;
      if (idle >= limit()) finishForMe();
    }, 100);
  });
}

// ---- close certificate ---------------------------------------------------------------------------
const initials = () => cleanInitials(store.get("rc-initials") || "");
function reviewedBox(on) { $("#reviewed .box").textContent = on ? `✓ ${initials() || "you"}` : " "; }
async function showCert() {
  const ver = ++S.certVer; // a newer cube (or a newer redraw) wins
  const facts = certFacts({
    total: S.total, mode: S.mode, low7: S.lowBy[7] ?? null, prot7: PROTECTED[7].length,
    workstreams: STEPS.map((s) => s.ws), mine: S.mine, initials: initials(),
  });
  try { await Promise.all(["800 150px Fraunces", "600 44px Inter", "600 32px 'IBM Plex Mono'"].map((f) => document.fonts.load(f))); } catch { /* fallback fonts */ }
  if (ver !== S.certVer || S.done !== 7) return;
  const c = document.createElement("canvas");
  drawCert(c, facts, (cv) => CubeView.prototype.draw.call({ ctx: cv.getContext("2d"), canvas: cv, cube: view.cube.copy(), yaw: VIEW_TOP.yaw, pitch: VIEW_TOP.pitch, turning: null }));
  S.cert = { canvas: c, facts };
  $("#cert-img").src = c.toDataURL("image/png");
  $("#cert-li").href = "https://www.linkedin.com/sharing/share-offsite/?url=" + encodeURIComponent(PAGE_URL);
  $("#cert-share").hidden = !navigator.share;
  $("#cert-initials").value = initials();
  $("#cert").hidden = false;
}
const certBlob = () => new Promise((res) => S.cert.canvas.toBlob(res, "image/png"));

// ---- intermission: "Are you watching closely?" --------------------------------------------
const I = { stage: 0, demo: null, scramble: [], saved: null };
function interlude(open) {
  $("#bench").classList.toggle("intermission", open);
  $("#interlude").hidden = !open;
  $("#steps-ui").hidden = open;
  $("#cube-label").textContent = open ? "The presenter’s cube" : "";
  $("#scramble-note").textContent = open ? "Your cube is safe in the drawer." : "";
  sound.setSection(open ? "breakdown" : "main");
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
  const clicks = { onMove: (_, m) => { if (S.clickOnLand && m[0] !== "y") sound.click(); }, gate };
  const animates = I.stage === 0 || I.stage === 2 || I.stage === 3;
  if (animates) { S.demo = true; syncMusic(); }
  // the presenter's 3-move "solve" lands on the beat; the reader's 25-turn sample runs in sixteenths
  if (I.stage === 0) await view.play(solve3, { timing: onGrid(BEAT), ...clicks });
  if (I.stage === 2) await view.play(randomScramble(25), { timing: onGrid(SIXTEENTH), ...clicks });
  if (I.stage === 3) await view.play(solve3, { timing: onGrid(BEAT), ...clicks });
  if (animates) { S.demo = false; syncMusic(0.6); }
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
  const go = () => { syncMusic(); hint(); };
  sound.ctx.state === "running" ? go() : sound.ctx.resume().then(go, () => {});
};
document.addEventListener("pointerdown", unlockSound, { passive: true });
document.addEventListener("keydown", unlockSound);
// Autoplay starts when the cube is well in view, and waits while it is scrolled fully out of view.
if (typeof IntersectionObserver === "function") {
  new IntersectionObserver(([e]) => {
    S.offscreen = e.intersectionRatio === 0;
    if (!S.offscreen) release();
    syncMusic(0.3);
    if (e.intersectionRatio >= 0.6 && S.auto && !S.started) { S.started = true; autoRun(); }
  }, { threshold: [0, 0.6] }).observe($("#stage"));
}
$("#speed").addEventListener("click", (e) => { S.fast = !S.fast; e.currentTarget.textContent = S.fast ? "Speed 2×" : "Speed 1×"; e.currentTarget.setAttribute("aria-pressed", String(S.fast)); });
const soundBtn = $("#sound");
const soundLabel = () => { soundBtn.textContent = sound.on ? "♪ On" : "♪ Off"; soundBtn.setAttribute("aria-pressed", String(sound.on)); };
soundBtn.addEventListener("click", () => { sound.setOn(!sound.on); store.set("rc-sound", sound.on ? "on" : "off"); if (sound.on) { unlockSound(); sound.tick(); } soundLabel(); hint(); });
soundLabel();
// Desktop: the tracker sits beside the cube, above the step card. Phone: under the cube.
const wide = matchMedia("(min-width: 900px)");
// The certificate sits just above the tracker in both layouts.
const placeTracker = () => {
  if (wide.matches) { $(".bench-side").prepend($("#tracker")); $(".bench-side").prepend($("#cert")); }
  else { $(".pin").after($("#tracker")); $(".pin").after($("#cert")); }
};
wide.addEventListener ? wide.addEventListener("change", placeTracker) : wide.addListener(placeTracker);
placeTracker();
$("#flip").addEventListener("click", () => view.lookAt(view.pitch > 0 ? VIEW_BOTTOM : VIEW_TOP));
document.querySelectorAll(".dot").forEach((d) => d.addEventListener("click", () => restart(() => jump(+d.dataset.step))));
$("#intermission-dot").addEventListener("click", () => restart(() => { jump(4); S.sawInterlude = false; interlude(true); }));
["kid", "cfo"].forEach((l) => $("#lens-" + l).addEventListener("click", () => { S.lens = l; store.set("rc-lens", l); render(); }));
document.querySelectorAll("#yt [data-m]").forEach((b) => b.addEventListener("click", () => S.yt && S.yt.tap(b.dataset.m, b)));
$("#yt-skip").addEventListener("click", () => S.yt && S.yt.skip());
$("#cert-close").addEventListener("click", () => { $("#cert").hidden = true; });
$("#cert-dl").addEventListener("click", async () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await certBlob());
  a.download = "close-certificate.png";
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
});
$("#cert-share").addEventListener("click", async () => {
  const file = new File([await certBlob()], "close-certificate.png", { type: "image/png" });
  const data = { title: "Close certificate", text: S.cert.facts.share, url: PAGE_URL };
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ ...data, files: [file] });
    else await navigator.share(data);
  } catch { /* the reader closed the share sheet */ }
});
let redraw = 0;
$("#cert-initials").addEventListener("input", (e) => {
  const v = cleanInitials(e.target.value);
  e.target.value = v;
  store.set("rc-initials", v);
  reviewedBox(S.done === 7);
  clearTimeout(redraw); redraw = setTimeout(showCert, 250);
});
$("#i-next").addEventListener("click", interludeNext);
$("#i-skip").addEventListener("click", () => { if (!I.busy) interlude(false); });

$("#kid-steps").innerHTML = STEPS.map((s, i) => `<li><b>${i + 1}. ${s.title}.</b> ${s.kid} <span class="recipe">${s.recipe}</span></li>`).join("");
$("#trick-words").textContent = words("R U R' U'");
checklist();
load(EXAMPLE, "example");
// ?debug exposes the internals to the browser tests (beat alignment, autoplay state). Nothing else reads it.
if (new URLSearchParams(location.search).has("debug")) window.__rc = { S, sound, view };
