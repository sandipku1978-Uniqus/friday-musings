// The close certificate: what it says (certFacts, pure, tested in Node) and how it looks (drawCert, a 1080x1350
// canvas in the page's working-paper style, sized for a LinkedIn feed image).

export const PAGE_URL = "https://friday-musings.vercel.app/2026-10-23-rubiks-cube/";

// Initials for the "Reviewed by" box: letters only, upper case, at most 3. Empty means "you".
export const cleanInitials = (s) => String(s || "").replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase();

export function certFacts({ total, mode, low7, prot7, workstreams, mine, initials }) {
  const who = cleanInitials(initials) || "you";
  const signed = workstreams.length;
  const lines = [
    `${total} turns on ${mode === "example" ? "the example cube" : "my own scramble"}`,
    low7 !== null && low7 !== undefined ? `Step 7 low point: ${low7} of ${prot7} pieces intact` : null,
    `Handed back: ${prot7} of ${prot7}`,
    mine ? `Magic trick run by hand: ${mine.tricks} ${mine.tricks === 1 ? "trick" : "tricks"}, ${mine.turns} turns` : null,
  ].filter(Boolean);
  return {
    title: "Closed.",
    summary: `${signed} of ${signed} workstreams signed off`,
    workstreams,
    lines,
    reviewer: who,
    motto: "Optimal is for computers. Repeatable is for teams.",
    share: `Closed the cube: ${signed} of ${signed} workstreams signed off in ${total} turns, and every recipe handed finished work back. Every ledger is its own scramble. #FridayMusings`,
  };
}

// paintCube(canvas) draws the solved cube onto a square canvas (the page passes its renderer in).
export function drawCert(canvas, f, paintCube) {
  const W = 1080, H = 1350, x = canvas.getContext("2d");
  canvas.width = W; canvas.height = H;
  const C = { paper: "#FAF6EA", sheet: "#FFFDF6", rule: "#D7E6D6", margin: "#E7A9A2", ink: "#24272B", soft: "#545A60", ledger: "#1D5A43", pencil: "#C3322B" };
  const serif = "Fraunces, Georgia, serif", sans = "Inter, system-ui, sans-serif", mono = "'IBM Plex Mono', ui-monospace, monospace";
  // draws text at the largest size up to `size` that fits in `maxW`
  const fit = (text, tx, ty, maxW, weight, size, family) => {
    let px = size;
    do { x.font = `${weight} ${px}px ${family}`; px -= 2; } while (x.measureText(text).width > maxW && px > 12);
    x.fillText(text, tx, ty);
  };
  x.fillStyle = C.sheet; x.fillRect(0, 0, W, H);
  x.fillStyle = C.rule;
  for (let y = 150; y < H; y += 46) x.fillRect(0, y, W, 2);
  x.fillStyle = C.margin; x.fillRect(84, 0, 3, H);

  // header strip, like the page's workpaper header
  x.fillStyle = C.sheet; x.fillRect(0, 0, W, 112);
  x.fillStyle = C.ink; x.fillRect(0, 110, W, 4);
  x.strokeStyle = C.ink; x.lineWidth = 3; x.strokeRect(120, 34, 178, 50);
  x.font = `600 30px ${mono}`; x.fillStyle = C.ink; x.textBaseline = "middle";
  x.fillText("W/P RC-7", 136, 60);
  x.fillStyle = C.soft; x.font = `600 26px ${mono}`;
  x.fillText("CLOSE CERTIFICATE", 330, 60);
  x.textAlign = "right"; x.fillStyle = C.pencil;
  x.fillText(`REVIEWED ✓ ${f.reviewer.toUpperCase()}`, W - 50, 60);
  x.textAlign = "left";

  // title and summary
  x.fillStyle = C.ink; x.textBaseline = "alphabetic";
  fit(f.title, 120, 300, W - 170, 800, 150, serif);
  x.fillStyle = C.ledger;
  fit(f.summary, 124, 372, W - 174, 600, 44, sans);

  // the solved cube, beside the workstream list
  const cube = document.createElement("canvas");
  cube.width = cube.height = 400;
  paintCube(cube);
  x.drawImage(cube, W - 440, 420, 400, 400);

  // workstreams with red-pencil tickmarks
  let y = 470;
  for (const w of f.workstreams) {
    x.save(); x.translate(132, y - 12); x.rotate(-0.12);
    x.fillStyle = C.pencil; x.font = `700 44px ${mono}`; x.fillText("✓", -14, 14);
    x.restore();
    x.fillStyle = C.ink;
    fit(w, 182, y, W - 182 - 450, 600, 38, sans);
    y += 58;
  }

  // facts
  y += 34;
  x.fillStyle = C.ink; x.fillRect(120, y - 46, W - 170, 3);
  x.fillStyle = C.ink;
  for (const line of f.lines) { fit(line, 124, y, W - 174, 600, 32, mono); y += 50; }
  y += 18;
  x.fillStyle = C.ledger;
  fit(f.motto, 124, y, W - 174, 600, 40, serif);

  // footer
  x.fillStyle = C.ink; x.fillRect(0, H - 120, W, 4);
  x.fillStyle = C.soft;
  fit("#FridayMusings · Sandip Khetan", 120, H - 66, W - 170, 600, 28, sans);
  fit(PAGE_URL.replace("https://", "").replace(/\/$/, ""), 120, H - 26, W - 170, 500, 26, mono);
}
