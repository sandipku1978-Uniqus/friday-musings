# Friday Musings

Interactive essays by Sandip Khetan, Co-Founder, Uniqus Consultech.

| Date | Musing | Path |
|---|---|---|
| 3 Oct 2026 | Who picks up when your agent calls? | `/2026-10-03-who-picks-up/` |
| 3 Oct 2026 | Give my concierge a chore (live demo) | `/concierge/` |

## What's here

- **`2026-10-03-who-picks-up/`**: the musing. Static page with a scripted concierge simulator, the controller's view, six bets, and an agent-readiness check.
- **`concierge/`**: a live AI concierge (Claude Sonnet 5.5). Visitors type everyday errands. It books with demo businesses that run agent gateways, creates calendar entries and drafts messages, all inside a mandate the visitor sets.
- **`/gateway/*` and `/.well-known/agent-card.json`**: five fictional businesses (restaurant, clinic, home services, insurer, gym) that answer AI agents. Any agent can call them, and receipts are Ed25519-signed.

### How the concierge works

```
browser ──POST /api/concierge──▶ agent loop (lib/agent.js) ──▶ Claude Sonnet 5.5
   ▲                                  │ tool calls
   │ NDJSON stream                    ▼
   └── wire lines, ledger,      lib/tools.js ── mandate checks ──▶ lib/gateway.js (demo businesses)
       approvals, receipts,                                           │
       calendar, drafts                                               ▼
                                                        signed receipts (lib/sign.js)
```

- **The mandate is enforced in code**, not in the prompt. `commit_offer` refuses anything over the spending cap. Offers over the ask-me line, and irreversible ones such as cancellations, need the visitor's click.
- **Approvals pause the run.** The server seals the agent's state (HMAC) and hands it to the browser. It resumes only with an untampered state and the visitor's decision.
- **Append-only history.** Sonnet 5.5 binds thinking blocks to the exact conversation, so the loop never edits earlier turns.
- **The gateway refuses identifiers.** Aadhaar-, PAN-, SSN-, Emirates ID- and card-like numbers, and OTPs, are rejected at the gateway.
- **Cost controls:** at most 10 model turns per run, prompt caching on the system prompt and tools, per-visitor and daily run limits. Each run shows its own API cost.

## Deploy (Vercel)

1. **Import the repo** in Vercel: New Project → this repository. Framework preset: *Other*. No build command, and leave the output directory empty.
2. **Set environment variables** (Settings → Environment Variables, Production):
   - `ANTHROPIC_API_KEY`: a key from console.anthropic.com. Put it in its own workspace with a **monthly spend limit**; this is the real backstop.
   - `RECEIPT_SECRET`: a random string, e.g. the output of `openssl rand -hex 32`. In production the concierge refuses to run without it.
   - Recommended before posting widely: Storage → add an **Upstash Redis (KV)** store to the project. That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, so rate limits are shared across instances.
3. **Deploy.** If the project name isn't `friday-musings`, update the `https://friday-musings.vercel.app/...` URLs in the `og:` meta tags and in the LinkedIn post text inside the musing.
4. **Check:** open `/concierge/`, run the Mumbai example, approve, then press "Verify signature" on a receipt.

Optional tuning (see `.env.example`): `RUNS_PER_HOUR` (default 6 per visitor), `DAILY_RUN_CAP` (default 200), `CONCIERGE_EFFORT` (default `medium`), `CONCIERGE_FALLBACKS` (`off` disables server-side refusal fallback).

**What it costs:** a typical run is 6 to 9 model turns, about $0.05 to $0.15 at Sonnet 5.5 prices ($2 / $10 per million input / output tokens) with caching. At the default daily cap of 200 runs, expect up to roughly $30 a day.

## Local development

```bash
npm install
npm run dev        # scripted model, no API key or spend: http://localhost:3000
npm run dev:live   # real model; needs .env.local (copy .env.example)
npm test           # gateway, signing, mandate enforcement, full approve/decline runs
```

## Adding a musing

Create `YYYY-MM-DD-slug/index.html` (self-contained, assets alongside), add a card to the root `index.html` and a row to the table above, and set the `og:*` tags so LinkedIn shows a preview card.

Personal views, not advice. The businesses in the demo are fictional; nothing booked through them is real.
