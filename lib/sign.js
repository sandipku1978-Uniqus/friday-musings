// Signing for the demo gateways and the concierge.
//
// Two primitives, both derived from one secret (RECEIPT_SECRET):
//   - Ed25519 receipts: anyone can verify them with the public key published in the agent cards.
//   - HMAC-sealed tokens: offers and paused agent state round-trip through the browser, and the
//     server rejects anything the client changed.

import crypto from "node:crypto";
import zlib from "node:zlib";

const DEV_SECRET = "dev-only-secret-do-not-use-in-production";
const SECRET = process.env.RECEIPT_SECRET || DEV_SECRET;

export const usingDevSecret = SECRET === DEV_SECRET;

// Ed25519 private key from a 32-byte seed, wrapped in a PKCS#8 DER envelope.
const seed = crypto.createHash("sha256").update("ed25519|" + SECRET).digest();
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
const publicKey = crypto.createPublicKey(privateKey);

export const publicJwk = publicKey.export({ format: "jwk" });
export const keyId = crypto.createHash("sha256").update(publicJwk.x).digest("hex").slice(0, 16);

const b64u = (buf) => Buffer.from(buf).toString("base64url");

// Stable JSON: sorted keys, so a signature doesn't depend on property order.
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().filter((k) => value[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function signReceipt(body) {
  const value = crypto.sign(null, Buffer.from(canonical(body)), privateKey).toString("base64url");
  return { ...body, signature: { alg: "Ed25519", kid: keyId, value } };
}

export function verifyReceipt(receipt) {
  try {
    if (!receipt || typeof receipt !== "object" || !receipt.signature) return false;
    const { signature, ...body } = receipt;
    if (signature.alg !== "Ed25519" || signature.kid !== keyId) return false;
    return crypto.verify(null, Buffer.from(canonical(body)), publicKey, Buffer.from(String(signature.value), "base64url"));
  } catch {
    return false;
  }
}

function mac(label, body) {
  return crypto.createHmac("sha256", SECRET).update(label + "|" + body).digest("base64url");
}

// Seal an object into "<body>.<mac>". Labels keep an offer token from being replayed as state.
export function seal(label, obj, { gzip = false } = {}) {
  const json = Buffer.from(JSON.stringify(obj));
  const body = gzip ? "z" + b64u(zlib.gzipSync(json)) : "j" + b64u(json);
  return body + "." + mac(label, body);
}

export function unseal(label, token) {
  if (typeof token !== "string" || token.length > 3_000_000) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 2) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(mac(label, body));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    const raw = Buffer.from(body.slice(1), "base64url");
    const json = body[0] === "z" ? zlib.gunzipSync(raw) : raw;
    return JSON.parse(json.toString("utf8"));
  } catch {
    return null;
  }
}

// One-way hash for rate-limit keys, so raw IP addresses are never stored.
export function hashId(value) {
  return crypto.createHmac("sha256", SECRET).update("id|" + value).digest("hex").slice(0, 24);
}
