// Canvas renderer for js/cube.js: 26 cubies, painter's order, a turning layer animated between states.
// No libraries, so it starts fast inside the LinkedIn in-app browser.
import { SLOTS, moveSpec, inLayer, rotMatrix, mul, slotOf } from "./cube.js";

export const STICKER = { Y: "#FFD200", W: "#FAFAF7", G: "#009B48", O: "#FF6A13", R: "#C8102E", B: "#0051BA" };
const BODY = "#17191C";
const CELLS = [...new Set(SLOTS.map((s) => s.p.join(",")))].map((k) => k.split(",").map(Number));
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const VIEW_TOP = { yaw: -0.62, pitch: 0.52 };
export const VIEW_BOTTOM = { yaw: -0.62, pitch: -0.6 };

export class CubeView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cube = null;
    this.yaw = VIEW_TOP.yaw; this.pitch = VIEW_TOP.pitch;
    this.turning = null; // { move, angle }
    this.token = 0;
    this.resize();
    if (typeof ResizeObserver === "function") new ResizeObserver(() => this.resize()).observe(canvas);
    this.bindDrag();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(r.width * dpr));
    if (this.canvas.width !== w) { this.canvas.width = w; this.canvas.height = w; }
    this.draw();
  }

  bindDrag() {
    let start = null;
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => { start = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch }; });
    c.addEventListener("pointermove", (e) => {
      if (!start) return;
      const k = 3.2 / c.getBoundingClientRect().width;
      this.yaw = start.yaw + (e.clientX - start.x) * k;
      if (e.pointerType !== "touch") this.pitch = Math.max(-1.2, Math.min(1.2, start.pitch + (e.clientY - start.y) * k));
      this.draw();
    });
    const end = () => { start = null; };
    c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end); c.addEventListener("pointerleave", end);
  }

  setCube(cube) { this.cube = cube; this.turning = null; this.draw(); }
  cancel() { this.token++; this.turning = null; this.draw(); }

  // Plays moves one by one; onMove(i, move) fires after each move lands on the cube.
  // `gate` (optional) is awaited before each move, so autoplay can pause between turns.
  // `timing` (optional) is awaited next and returns the move's duration in ms, so turns can land on the music's beat.
  async play(moves, { ms = 260, onMove = () => {}, gate = null, timing = null } = {}) {
    const my = ++this.token;
    for (let i = 0; i < moves.length; i++) {
      if (gate) await gate();
      if (my !== this.token) return false;
      const m = moves[i];
      let dur = ms * (m.endsWith("2") ? 1.45 : 1);
      if (timing) { dur = await timing(m); if (my !== this.token) return false; }
      if (reduced()) dur = 0;
      if (dur > 0) {
        const t0 = performance.now();
        await new Promise((res) => {
          const tick = (now) => {
            if (my !== this.token) return res();
            const t = Math.min(1, (now - t0) / dur);
            this.turning = { move: m, t: ease(t) };
            this.draw();
            t < 1 ? requestAnimationFrame(tick) : res();
          };
          requestAnimationFrame(tick);
        });
      }
      if (my !== this.token) return false;
      this.turning = null;
      this.cube.apply(m);
      this.draw();
      onMove(i, m);
    }
    return true;
  }

  lookAt(view, ms = 650) {
    const from = { yaw: this.yaw, pitch: this.pitch }, t0 = performance.now(), dur = reduced() ? 1 : ms;
    return new Promise((res) => {
      const tick = (now) => {
        const t = ease(Math.min(1, (now - t0) / dur));
        this.yaw = from.yaw + (view.yaw - from.yaw) * t;
        this.pitch = from.pitch + (view.pitch - from.pitch) * t;
        this.draw();
        t < 1 ? requestAnimationFrame(tick) : res();
      };
      requestAnimationFrame(tick);
    });
  }

  draw() {
    const { ctx, canvas, cube } = this;
    const W = canvas.width;
    ctx.clearRect(0, 0, W, W);
    if (!cube) return;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const view = ([x, y, z]) => { const x1 = cy * x + sy * z, z1 = -sy * x + cy * z; return [x1, cp * y - sp * z1, sp * y + cp * z1]; };
    const scale = W * 0.168, dist = 9;
    const proj = ([x, y, z]) => { const f = dist / (dist - z); return [W / 2 + x * scale * f, W / 2 - y * scale * f]; };
    let R = null, spec = null;
    if (this.turning) {
      spec = moveSpec(this.turning.move);
      R = rotMatrix(spec.axis, (-Math.PI / 2) * spec.turns * this.turning.t);
    }
    const light = (() => { const l = [-0.35, 0.75, 0.55], n = Math.hypot(...l); return l.map((v) => v / n); })();
    const cells = CELLS.map((p) => {
      const moving = R && inLayer(this.turning.move, p);
      const tf = (v) => view(moving ? mul(R, v) : v);
      return { p, tf, depth: tf(p)[2] };
    }).sort((a, b) => a.depth - b.depth);

    const h = 0.485, inset = 0.4;
    for (const { p, tf } of cells) {
      for (const d of DIRS) {
        const nView = tf(d).map((v, i) => v - tf([0, 0, 0])[i]);
        const c = [p[0] + d[0] * h, p[1] + d[1] * h, p[2] + d[2] * h];
        const cv = tf(c);
        // visible when the face points towards the camera at (0, 0, dist)
        if (nView[0] * -cv[0] + nView[1] * -cv[1] + nView[2] * (dist - cv[2]) <= 0) continue;
        const [u, v] = d[0] ? [[0, 1, 0], [0, 0, 1]] : d[1] ? [[1, 0, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0]];
        const quad = (s) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => proj(tf([c[0] + (u[0] * a + v[0] * b) * s, c[1] + (u[1] * a + v[1] * b) * s, c[2] + (u[2] * a + v[2] * b) * s])));
        const shade = 0.8 + 0.2 * Math.max(0, light[0] * nView[0] + light[1] * nView[1] + light[2] * nView[2]);
        poly(ctx, quad(h), BODY, 0);
        const outer = p[0] * d[0] + p[1] * d[1] + p[2] * d[2] === 1;
        if (!outer) continue;
        const col = cube.s[slotOf(p, d)];
        poly(ctx, quad(inset), shadeHex(STICKER[col], shade), W * 0.012);
      }
    }
  }
}

function poly(ctx, pts, fill, round) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (round) { ctx.lineJoin = "round"; ctx.lineWidth = round; ctx.strokeStyle = fill; ctx.stroke(); }
}

function shadeHex(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => Math.round(Math.min(255, ((n >> s) & 255) * k));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
