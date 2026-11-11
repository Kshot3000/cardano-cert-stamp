// Certificate model and fingerprint (per Bob's build spec, section 4).
//
//   fields = { cert_no, recipient_name, course, date_awarded, issuer, [issuer_addr], [grade], [expires] }
//   d      = SHA-256( "kshot-cert-v1" || salt(32 bytes) || canonical_json(fields) [|| pdf_sha256(32 bytes)] )
//
// canonical_json: keys sorted, strings NFC-normalised, trimmed, inner whitespace
// collapsed, empty optional fields dropped, no insignificant whitespace.
// The random 32-byte salt keeps low-entropy fields (name + course + date) from
// being guessed from the on-chain root. d is the leaf digest in the Merkle tree.
import { sha256, toHex, fromHex, concat, isHash } from './hash.js';
import { paymentCredential } from './address.js';

export const DOMAIN = 'kshot-cert-v1';
export const FIELDS = ['cert_no', 'recipient_name', 'course', 'date_awarded', 'issuer', 'issuer_addr', 'grade', 'expires'];
export const REQUIRED = ['cert_no', 'recipient_name', 'course', 'date_awarded', 'issuer'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function clean(v) {
  return typeof v === 'string' ? v.normalize('NFC').trim().replace(/\s+/g, ' ') : v == null ? '' : String(v);
}

export function normalizeFields(f) {
  const out = {};
  for (const k of FIELDS) { const v = clean(f?.[k]); if (v) out[k] = v; }
  return out;
}

export function validateFields(f) {
  const n = normalizeFields(f);
  const errors = [];
  for (const k of REQUIRED) if (!n[k]) errors.push(`${k} is required`);
  if (n.date_awarded && !DATE.test(n.date_awarded)) errors.push('date_awarded must be YYYY-MM-DD');
  if (n.expires && !DATE.test(n.expires)) errors.push('expires must be YYYY-MM-DD');
  if (n.issuer_addr && !paymentCredential(n.issuer_addr)) errors.push('issuer_addr is not a valid Cardano address');
  for (const [k, v] of Object.entries(n)) if (v.length > 200) errors.push(`${k} is too long`);
  for (const k of Object.keys(f || {})) if (!FIELDS.includes(k)) errors.push(`unknown field ${k}`);
  return errors;
}

export function canonicalFields(f) {
  const n = normalizeFields(f);
  return '{' + Object.keys(n).sort().map((k) => JSON.stringify(k) + ':' + JSON.stringify(n[k])).join(',') + '}';
}

export function newSalt() {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return toHex(b);
}

/** d for one certificate. saltHex: 64 hex; pdfHashHex optional 64 hex. */
export async function certificateDigest(fields, saltHex, pdfHashHex) {
  const errors = validateFields(fields);
  if (errors.length) throw new Error('Invalid certificate: ' + errors.join('; '));
  if (!isHash(saltHex)) throw new Error('salt must be 32 bytes (64 hex chars)');
  const parts = [new TextEncoder().encode(DOMAIN), fromHex(saltHex), new TextEncoder().encode(canonicalFields(fields))];
  if (pdfHashHex) {
    if (!isHash(pdfHashHex)) throw new Error('pdf hash must be 64 hex chars');
    parts.push(fromHex(pdfHashHex));
  }
  return toHex(await sha256(concat(...parts)));
}

export async function fileSha256(bytes) {
  return toHex(await sha256(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
}
