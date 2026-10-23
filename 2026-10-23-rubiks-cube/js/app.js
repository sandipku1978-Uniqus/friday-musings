// Page wiring: the workbench (cube + 7 steps + red-pencil counter), the intermission, and the close checklist.
import { Cube, solve, randomScramble, intactCount, piecesHome, PROTECTED, turnCount, invert, parse, WORDS } from "./cube.js";
import { CubeView, VIEW_TOP, VIEW_BOTTOM } from "./view.js";
import { STEPS, CHECKS, words } from "./steps.js";

const $ = (s) => document.querySelector(s);
const EXAMPLE = "L2 R U2 B F' B' U R F R2 L2 D' L D' R' D' R F' R F' U' L R2 L B2";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: fine */ } },
};

const view = new CubeView($("#stage"));
const S = { mode: "example", snaps: [], segs: [], done: 0, playing: false, fast: false, lens: store.get("rc-lens") || "cfo", low: null, cstep: 1, total: 0 };

function load(scramble, mode) {
  view.cancel();
  const start = new Cube().applySeq(scramble);
  const segs = solve(start);
  const snaps = [null, start.copy()];
  for (let k = 1; k <= 7; k++) {
    const c = snaps[k].copy();
    segs.filter((s) => s.step === k).forEach((s) => c.applySeq(s.moves));
    snaps[k + 1] = c;
  }
  Object.assign(S, { mode, segs, snaps, done: 0, playing: false, low: null, cstep: 1, total: turnCount(segs.flatMap((s) => s.moves)) });
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
  next.disabled = S.playing;
  next.textContent = solved ? "Solved! Scramble a new one" : S.done === 3 && !S.sawInterlude ? "Intermission: who scrambled it?" : `Show me step ${k}`;
  $("#replay").disabled = S.playing || S.done === 0;
  counter(view.cube, S.cstep);
  card(solved ? 7 : k, solved || (S.done >= k));
}

function counter(c, k) {
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

async function playStep(k) {
  if (S.playing) return;
  S.playing = true; S.low = null; S.cstep = k;
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
      onMove: (_, m) => {
        if (m[0] !== "y") done++;
        ticker(seg, m, done, n);
        const now = intactCount(view.cube, k);
        S.low = S.low === null ? now : Math.min(S.low, now);
        counter(view.cube, k);
      },
    });
    if (!ok) { S.playing = false; return; }
  }
  S.playing = false;
  S.done = k;
  ticker(null, "", 0, 0);
  $("#caption").textContent = `✓ ${STEPS[k - 1].result}`;
  if (k <= 2) { $("#caption").textContent += " (bottom view)"; view.lookAt(VIEW_BOTTOM); }
  if (k === 7) finale();
  render();
}

function finale() {
  $("#reviewed").classList.add("on");
  $("#caption").textContent = `✓ Solved in ${S.total} turns. A computer needs 20 or fewer.`;
}

function jump(k) {
  view.cancel();
  S.playing = false; S.low = null; S.cstep = k;
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
    $("#interlude").scrollIntoView({ block: "nearest", behavior: "smooth" });
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
  const btn = $("#i-next");
  btn.disabled = true;
  const solve3 = invert(I.scramble).split(" ");
  if (I.stage === 0) await view.play(solve3, { ms: 650 });
  if (I.stage === 2) await view.play(randomScramble(25), { ms: 70 });
  if (I.stage === 3) await view.play(solve3, { ms: 650 });
  if (I.stage === 4) { btn.disabled = false; return interlude(false); }
  I.stage++;
  interludeRender();
  btn.disabled = false;
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
  if (S.done === 7) return load(randomScramble(25).join(" "), "mine");
  if (S.done === 3 && !S.sawInterlude) return interlude(true);
  playStep(S.done + 1);
});
$("#replay").addEventListener("click", () => playStep(Math.max(1, S.done)));
$("#scramble").addEventListener("click", () => load(randomScramble(25).join(" "), "mine"));
$("#example").addEventListener("click", () => load(EXAMPLE, "example"));
$("#speed").addEventListener("click", (e) => { S.fast = !S.fast; e.currentTarget.textContent = S.fast ? "Speed 2×" : "Speed 1×"; e.currentTarget.setAttribute("aria-pressed", String(S.fast)); });
$("#flip").addEventListener("click", () => view.lookAt(view.pitch > 0 ? VIEW_BOTTOM : VIEW_TOP));
document.querySelectorAll(".dot").forEach((d) => d.addEventListener("click", () => jump(+d.dataset.step)));
$("#intermission-dot").addEventListener("click", () => { jump(4); S.sawInterlude = false; interlude(true); });
["kid", "cfo"].forEach((l) => $("#lens-" + l).addEventListener("click", () => { S.lens = l; store.set("rc-lens", l); render(); }));
$("#i-next").addEventListener("click", interludeNext);
$("#i-skip").addEventListener("click", () => interlude(false));

$("#kid-steps").innerHTML = STEPS.map((s, i) => `<li><b>${i + 1}. ${s.title}.</b> ${s.kid} <span class="recipe">${s.recipe}</span></li>`).join("");
$("#trick-words").textContent = words("R U R' U'");
checklist();
load(EXAMPLE, "example");
