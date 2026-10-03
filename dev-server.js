// Local stand-in for Vercel: serves the static pages, the /api functions and the rewrites in
// vercel.json. Run `npm run dev` (scripted model, no API key needed) or `npm run dev:live`.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const { rewrites } = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };

function rewrite(pathname) {
  for (const r of rewrites) {
    const names = [];
    const re = new RegExp("^" + r.source.replace(/\./g, "\\.").replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)")) + "$");
    const m = re.exec(pathname);
    if (m) return names.reduce((dest, n, i) => dest.replace(":" + n, m[i + 1]), r.destination);
  }
  return pathname;
}

http.createServer(async (req, res) => {
  const url = new URL(rewrite(new URL(req.url, "http://x").pathname) + (new URL(req.url, "http://x").search || ""), "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const file = path.join(root, url.pathname + ".js");
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
    req.query = Object.fromEntries(url.searchParams);
    const mod = await import(pathToFileURL(file).href);
    return mod.default(req, res);
  }
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT) || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));
