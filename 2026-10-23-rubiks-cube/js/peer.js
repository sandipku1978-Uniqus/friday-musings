// "Peer review" on the page: one question at a time, one tap each, then the room's answers grow out of the same rows.
// The section stays hidden unless /api/poll says the shared tally is on. Answers are remembered in this browser so a
// reader is never asked twice; the server keeps only counts.
import { POLL, shares } from "./poll.js";

const $ = (s) => document.querySelector(s);
const API = "/api/poll";

export function initPeer(store) {
  const P = { enabled: false, min: POLL.min, counts: {}, mine: {}, cur: 0, busy: false };
  try { P.mine = JSON.parse(store.get("rc-peer") || "{}") || {}; } catch { P.mine = {}; }
  const save = () => store.set("rc-peer", JSON.stringify(P.mine));
  const firstOpen = () => { const i = POLL.questions.findIndex((q) => !P.mine[q.id]); return i < 0 ? POLL.questions.length : i; };

  function dots(i) {
    $("#pr-dots").innerHTML = POLL.questions.map((_, j) => `<i class="${j < i || (j === i && P.mine[POLL.questions[j].id]) ? "on" : ""}"></i>`).join("");
  }

  function renderQuestion(i) {
    const q = POLL.questions[i], answered = P.mine[q.id];
    P.cur = i;
    $("#pr").classList.remove("summary");
    $("#pr-step").textContent = `${i + 1} of ${POLL.questions.length}`;
    dots(i);
    $("#pr-q").textContent = q.text;
    const { total, rows } = shares(q, P.counts[q.id]);
    const open = answered && total >= P.min;
    const list = $("#pr-opts");
    list.innerHTML = "";
    rows.forEach((r) => {
      const li = document.createElement("li"), b = document.createElement("button");
      b.type = "button";
      b.className = "pr-opt" + (answered === r.id ? " you" : "") + (answered ? " done" : "");
      b.innerHTML = `<span class="bar"></span><span class="lbl"></span><span class="pct mono"></span>`;
      b.querySelector(".lbl").textContent = r.label + (answered === r.id ? "  ✓ you" : "");
      if (open) {
        b.querySelector(".pct").textContent = `${r.pct}%`;
        b.setAttribute("aria-label", `${r.label}: ${r.pct} percent, ${r.count} of ${total}${answered === r.id ? ", your answer" : ""}`);
        requestAnimationFrame(() => requestAnimationFrame(() => { b.querySelector(".bar").style.width = `${r.pct}%`; }));
      }
      if (answered) b.setAttribute("aria-disabled", "true");
      else b.addEventListener("click", () => vote(q, r.id));
      li.append(b); list.append(li);
    });
    $("#pr-n").textContent = !answered ? "One tap. Anonymous." :
      open ? `${total} answers` : `Results open at ${P.min} answers. ${total} so far, including yours.`;
    const next = $("#pr-next");
    next.hidden = !answered;
    next.textContent = i < POLL.questions.length - 1 ? "Next question →" : "See all three";
  }

  function renderSummary() {
    $("#pr").classList.add("summary");
    $("#pr-step").textContent = "Your answers are in";
    dots(POLL.questions.length);
    $("#pr-q").textContent = "You and the room";
    const list = $("#pr-opts");
    list.innerHTML = "";
    for (const q of POLL.questions) {
      const { total, rows } = shares(q, P.counts[q.id]);
      const top = [...rows].sort((a, b) => b.count - a.count)[0], you = rows.find((r) => r.id === P.mine[q.id]);
      const li = document.createElement("li");
      li.className = "pr-sum";
      const room = total >= P.min ? `The room: ${top.label}, ${top.pct}%` : `The room: opens at ${P.min} answers (${total} so far)`;
      const mine = you ? `You: ${you.label}${total >= P.min && you.id === top.id ? ", with the room" : ""}` : "You: skipped";
      li.innerHTML = `<span class="sum-q"></span><span class="sum-room mono"></span><span class="sum-you"></span>`;
      li.querySelector(".sum-q").textContent = q.text;
      li.querySelector(".sum-room").textContent = room;
      li.querySelector(".sum-you").textContent = mine;
      list.append(li);
    }
    $("#pr-n").textContent = "Counted anonymously. Share the page and the room gets bigger.";
    const next = $("#pr-next");
    next.hidden = false;
    next.textContent = "Review question 1";
  }

  async function vote(q, aid) {
    if (P.busy || P.mine[q.id]) return;
    P.busy = true;
    $("#pr-n").textContent = "Counting…";
    const failed = "That answer did not go through. Please try again.";
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: q.id, a: aid }) });
      const data = await r.json().catch(() => ({}));
      // the server says why (the network's hourly cap, a store outage), so show its words
      if (!r.ok || !data.counts) { $("#pr-n").textContent = data.error || failed; return; }
      P.counts[q.id] = data.counts;
      P.min = data.min || P.min;
      P.mine[q.id] = aid;
      save();
      renderQuestion(POLL.questions.indexOf(q));
    } catch {
      $("#pr-n").textContent = failed;
    } finally {
      P.busy = false;
    }
  }

  $("#pr-next").addEventListener("click", () => {
    if ($("#pr").classList.contains("summary")) return renderQuestion(0);
    const i = P.cur + 1;
    i < POLL.questions.length ? renderQuestion(i) : renderSummary();
  });

  const ready = fetch(API)
    .then((r) => (r.ok ? r.json() : { enabled: false }))
    .then((data) => {
      if (!data || !data.enabled) return false;
      P.enabled = true; P.min = data.min || P.min; P.counts = data.counts || {};
      $("#peer").hidden = false;
      const i = firstOpen();
      i < POLL.questions.length ? renderQuestion(i) : renderSummary();
      return true;
    })
    .catch(() => false);
  return { ready, get enabled() { return P.enabled; } };
}
