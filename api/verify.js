// POST /api/verify  { receipt } → { valid, kid }
// Checks a demo receipt's Ed25519 signature against the public key in the agent cards.

import { verifyReceipt, keyId } from "../lib/sign.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.statusCode = 204;
    return res.end();
  }
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const receipt = body?.receipt;
  res.statusCode = receipt ? 200 : 400;
  res.end(JSON.stringify(receipt ? { valid: verifyReceipt(receipt), kid: keyId } : { error: "Send { receipt }." }));
}
