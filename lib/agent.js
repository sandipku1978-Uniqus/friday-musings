// The concierge's agent loop: Claude Sonnet 5.5 with a manual tool-use loop.
//
// History is append-only (Sonnet 5.5 binds thinking blocks to the exact conversation). The loop
// pauses in two cases and hands the browser a sealed state to resume with: the visitor must
// approve an offer, or the serverless time limit is near.

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM, TOOLS } from "./prompt.js";
import { execute } from "./tools.js";

export const MODEL = process.env.CONCIERGE_MODEL || "claude-sonnet-5-5";
const EFFORT = process.env.CONCIERGE_EFFORT || "medium";
const USE_FALLBACKS = process.env.CONCIERGE_FALLBACKS !== "off";
export const MAX_TURNS = 10;
const TURN_HEADROOM_MS = 45000;

// USD per million tokens, Claude Sonnet 5.5.
const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

let sharedClient;
const defaultClient = () => (sharedClient ??= new Anthropic({ timeout: 90000, maxRetries: 1 }));

function request(client, messages) {
  const params = {
    model: MODEL,
    max_tokens: 12000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: TOOLS,
    tool_choice: { type: "auto" },
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: EFFORT },
    cache_control: { type: "ephemeral" },
    messages,
  };
  if (!USE_FALLBACKS) return client.messages.create(params);
  return client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
}

function addUsage(state, u = {}) {
  const s = state.usage;
  s.input += u.input_tokens || 0;
  s.output += u.output_tokens || 0;
  s.cacheRead += u.cache_read_input_tokens || 0;
  s.cacheWrite += u.cache_creation_input_tokens || 0;
  s.costUsd = (s.input * PRICE.input + s.output * PRICE.output + s.cacheRead * PRICE.cacheRead + s.cacheWrite * PRICE.cacheWrite) / 1e6;
}

function stopEarly(state, emit, headline) {
  state.done = true;
  emit({ t: "plan", plan: { headline, errands: state.errands.map((e) => ({ ref: e.ref, status: "skipped", outcome: "Not finished in this run.", your_next_step: "" })) } });
}

// Applies the visitor's decision to a paused approval and queues the turn's tool results.
export function applyDecision(state, decision, emit) {
  const p = state.pending;
  if (!p) return;
  const approved = decision === "approve";
  state.approvals[p.offer.offer_id] = approved;
  emit({ t: "ledger", kind: approved ? "ok" : "bad", title: approved ? "Approved by you" : "Declined by you", detail: `${p.offer.offer_id} · human-in-the-loop evidence captured` });
  const result = {
    type: "tool_result", tool_use_id: p.toolUseId,
    content: JSON.stringify(approved
      ? { decision: "approved", next: "Call commit_offer for this offer." }
      : { decision: "declined", next: "Do not commit. Record the errand as skipped and say what the visitor can do instead." }),
  };
  state.messages.push({ role: "user", content: [...p.results, result] });
  state.pending = null;
}

// Returns "done" | "paused" | "continue".
export async function runLoop(state, emit, { client = defaultClient(), deadline = Infinity } = {}) {
  while (!state.done) {
    if (state.turns >= MAX_TURNS) {
      emit({ t: "ledger", kind: "warn", title: "Step budget reached", detail: `Stopped after ${MAX_TURNS} model turns to cap cost` });
      stopEarly(state, emit, "I ran out of steps before finishing everything. The items above are what I completed.");
      break;
    }
    if (Date.now() > deadline - TURN_HEADROOM_MS) return "continue";

    state.turns += 1;
    emit({ t: "status", text: state.turns === 1 ? "Reading your errands" : "Working" });
    const res = await request(client, state.messages);
    addUsage(state, res.usage);
    emit({ t: "usage", usage: state.usage, turns: state.turns });

    if (res.stop_reason === "refusal") {
      emit({ t: "error", message: "The concierge declined this request. It only handles everyday errands." });
      stopEarly(state, emit, "Nothing was done.");
      break;
    }
    state.messages.push({ role: "assistant", content: res.content });
    for (const b of res.content) {
      if (b.type === "thinking" && b.thinking) emit({ t: "thought", text: b.thinking });
      if (b.type === "text" && b.text.trim()) emit({ t: "say", text: b.text });
    }

    const uses = res.content.filter((b) => b.type === "tool_use");
    if (!uses.length) {
      if (state.nudged) {
        stopEarly(state, emit, "The concierge stopped without a final summary.");
        break;
      }
      state.nudged = true;
      state.messages.push({ role: "user", content: [{ type: "text", text: "Call finish now with the status of every errand." }] });
      continue;
    }

    const results = [];
    let pause = null;
    const finishes = uses.filter((u) => u.name === "finish");
    for (const u of uses.filter((x) => x.name !== "finish")) {
      if (u.name === "request_approval" && pause) {
        results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: JSON.stringify({ error: "ONE_AT_A_TIME", message: "One approval at a time. Ask again after the visitor decides." }) });
        continue;
      }
      const out = execute(u.name, u.input, state, emit);
      if (out.pause) {
        pause = { ...out.pause, toolUseId: u.id };
        continue;
      }
      results.push({ type: "tool_result", tool_use_id: u.id, content: out.content, ...(out.is_error ? { is_error: true } : {}) });
    }
    if (finishes.length && !pause) {
      execute("finish", finishes[0].input, state, emit);
      break;
    }
    for (const f of finishes) {
      results.push({ type: "tool_result", tool_use_id: f.id, is_error: true, content: JSON.stringify({ error: "NOT_YET", message: "Wait for the visitor's approval, then call finish." }) });
    }
    if (pause) {
      state.pending = { ...pause, results };
      return "paused";
    }
    state.messages.push({ role: "user", content: results });
  }
  return "done";
}
