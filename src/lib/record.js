// CIP-190 Proof-of-Existence record under transaction metadata label 309.
// Body (canonical CBOR):
//   { "v": 1,
//     "merkle": [ { "alg": "rfc9162-sha256", "root": <32 bytes>, "leaf_count": N } ],
//     "x-kshot": { "kind": "cert-batch", "ver": 1, "app": "kshot-cert-stamp", "app_ver": "0.1.0" } }
// Carried on-chain as an array of <=64-byte byte strings whose concatenation
// is the body (CIP-190 "chunk-array transport"). Optional label 674 (CIP-20)
// memo holds a public batch title. No personal data ever goes in either.
import { encode, decode } from './cbor.js';
import { fromHex, toHex, isHash, concat } from './hash.js';

export const LABEL = 309;
export const MEMO_LABEL = 674;
export const MERKLE_ALG = 'rfc9162-sha256';
// Stable app identifier so usage can be counted from the chain (scripts/count-usage.mjs).
export const APP_ID = 'kshot-cert-stamp';
export const APP_VERSION = '0.1.0';
export const EXT = { kind: 'cert-batch', ver: 1, app: APP_ID, app_ver: APP_VERSION };
const KNOWN = new Set(['v', 'items', 'merkle', 'supersedes', 'sigs', 'crit']);

export function buildRecordBody(rootHex, leafCount) {
  if (!isHash(rootHex)) throw new Error('root must be 64 lowercase hex chars');
  if (!Number.isInteger(leafCount) || leafCount < 1 || leafCount > 0xffffffff) throw new Error('leaf_count out of range');
  return encode({ v: 1, merkle: [{ alg: MERKLE_ALG, root: fromHex(rootHex), leaf_count: leafCount }], 'x-kshot': EXT });
}

/** Minimal split: every chunk 64 bytes except the last. */
export function chunk(body) {
  const out = [];
  for (let i = 0; i < body.length; i += 64) out.push(body.slice(i, i + 64));
  return out;
}

export function reassemble(chunks) {
  if (!Array.isArray(chunks) || !chunks.length) throw new Error('label 309 value must be a non-empty chunk array');
  const parts = chunks.map((c) => {
    let b;
    if (c instanceof Uint8Array) b = c;
    else if (typeof c === 'string' && /^(0x)?([0-9a-fA-F]{2})*$/.test(c)) b = fromHex(c.replace(/^0x/, '').toLowerCase());
    else if (c && typeof c === 'object' && typeof c.bytes === 'string') b = fromHex(c.bytes.toLowerCase());
    else throw new Error('label 309 chunk is not a byte string');
    if (b.length > 64) throw new Error('CHUNK_TOO_LARGE');
    return b;
  });
  return concat(...parts);
}

/** Metadata entries for the stamp tx: { 309: chunks, 674?: memo }. */
export function buildStampMetadata(rootHex, leafCount, title) {
  const md = { [LABEL]: chunk(buildRecordBody(rootHex, leafCount)) };
  const t = String(title || '').normalize('NFC').trim();
  if (t) {
    const bytes = new TextEncoder().encode(t);
    if (bytes.length > 64) throw new Error('Batch title must be 64 bytes or less');
    md[MEMO_LABEL] = { msg: [t], app: APP_ID };
  } else {
    md[MEMO_LABEL] = { msg: ['Certificate batch'], app: APP_ID };
  }
  return md;
}

/**
 * Parse the label-309 value from an indexer's metadata JSON (Koios gives
 * byte strings as "0x..." hex). Returns { merkle: [{ root, leafCount }], ext } or null.
 */
export function parseRecord(metadata) {
  if (!metadata) return null;
  const value = metadata[LABEL] ?? metadata[String(LABEL)];
  if (!value) return null;
  let body;
  try { body = decode(reassemble(value)); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.v !== 1) return null;
  for (const k of Object.keys(body)) if (!KNOWN.has(k) && !/^x-.+/.test(k) && !/^[a-z]+-.+/.test(k)) return null;
  if (Array.isArray(body.crit) && body.crit.some((c) => c !== 'x-kshot')) return null; // unsupported critical extension
  const merkle = (Array.isArray(body.merkle) ? body.merkle : [])
    .filter((m) => m && m.alg === MERKLE_ALG && m.root instanceof Uint8Array && m.root.length === 32 && Number.isInteger(m.leaf_count) && m.leaf_count >= 1)
    .map((m) => ({ root: toHex(m.root), leafCount: m.leaf_count }));
  if (!merkle.length) return null;
  return { merkle, ext: body['x-kshot'] || null };
}
