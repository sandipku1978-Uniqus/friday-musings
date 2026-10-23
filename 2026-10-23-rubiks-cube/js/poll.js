// "Peer review": three questions, one tap each, then the room's answers. The page and /api/poll both read this file,
// so the server only ever counts answers that exist here. Only counts are stored: no IPs, no cookies, no free text.

export const POLL = {
  id: "rc1",
  min: 20, // a question's results open once it has this many answers
  questions: [
    {
      id: "worst",
      text: "Which part of your close looks worst right before it comes good?",
      options: [
        { id: "cash", label: "Cash" },
        { id: "subledgers", label: "Subledgers" },
        { id: "interco", label: "Intercompany" },
        { id: "accruals", label: "Accruals and classification" },
        { id: "flux", label: "Flux review" },
        { id: "consol", label: "Consolidation" },
        { id: "suspense", label: "Suspense and final adjustments" },
      ],
    },
    {
      id: "sample",
      text: "Who picks the samples your key controls are tested on?",
      options: [
        { id: "independent", label: "An independent tester" },
        { id: "owner", label: "The control owner’s team" },
        { id: "preparer", label: "The preparer of the work being tested" },
        { id: "unsure", label: "Not sure, which is its own answer" },
      ],
    },
    {
      id: "recipes",
      text: "If your best close person left on Friday, how much of the close runs on written recipes?",
      options: [
        { id: "all", label: "All of it" },
        { id: "most", label: "Most of it" },
        { id: "half", label: "Half of it" },
        { id: "less", label: "Less than half" },
      ],
    },
  ],
};

export const question = (qid) => POLL.questions.find((q) => q.id === qid);
export const validAnswer = (qid, aid) => Boolean(question(qid)?.options.some((o) => o.id === aid));

// Whole-number percentages that add up to exactly 100 (largest remainder), plus the exact counts behind them.
export function shares(q, counts) {
  const n = q.options.map((o) => Math.max(0, Number(counts?.[o.id]) || 0));
  const total = n.reduce((a, b) => a + b, 0);
  if (!total) return { total, rows: q.options.map((o) => ({ ...o, count: 0, pct: 0 })) };
  const raw = n.map((c) => (100 * c) / total), pct = raw.map(Math.floor);
  let left = 100 - pct.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { pct[i]++; left--; } });
  return { total, rows: q.options.map((o, i) => ({ ...o, count: n[i], pct: pct[i] })) };
}
