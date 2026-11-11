// Self-contained verify links (Bob's spec, section 6). Everything sits after
// '#', which browsers never send to a web server:
//
//   verify.html#n=preprod&tx=<hex>&i=<leaf index>&s=<salt b64url>&f=<fields JSON b64url>&p=<proof b64url>[&h=<pdf sha256 b64url>]
//
// p is the RFC 9162 audit path packed as concatenated 32-byte hashes.
// The tree size is not in the link: the verifier reads leaf_count from chain.
import { fromHex, toHex, isHash } from './hash.js';
import { normalizeFields } from './certificate.js';

export const NETWORKS = ['mainnet', 'preprod', 'preview'];

export function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('bad base64url');
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

const hexToB64 = (h) => b64urlEncode(fromHex(h));
const b64ToHex = (s) => toHex(b64urlDecode(s));

export function encodeFragment({ network, txHash, index, salt, fields, proof, pdfHash }) {
  if (!NETWORKS.includes(network)) throw new Error('Unknown network: use mainnet, preprod or preview');
  if (!isHash(txHash)) throw new Error('Bad tx hash');
  if (!Number.isInteger(index) || index < 0) throw new Error('Bad index');
  if (!isHash(salt)) throw new Error('Bad salt');
  const packed = new Uint8Array((proof || []).length * 32);
  (proof || []).forEach((h, k) => packed.set(fromHex(h), k * 32));
  const parts = [
    `n=${network}`, `tx=${txHash}`, `i=${index}`, `s=${hexToB64(salt)}`,
    `f=${b64urlEncode(new TextEncoder().encode(JSON.stringify(normalizeFields(fields))))}`,
    `p=${b64urlEncode(packed)}`,
  ];
  if (pdfHash) parts.push(`h=${hexToB64(pdfHash)}`);
  return parts.join('&');
}

export function decodeFragment(fragment) {
  const q = new URLSearchParams(String(fragment).replace(/^.*?#/, '').replace(/^#/, ''));
  const network = q.get('n'), txHash = (q.get('tx') || '').toLowerCase();
  if (!NETWORKS.includes(network)) throw new Error('This link is not for a supported Cardano network');
  if (!isHash(txHash)) throw new Error('Link has no valid transaction hash');
  const index = Number(q.get('i'));
  if (!Number.isInteger(index) || index < 0) throw new Error('Link has no valid certificate index');
  const salt = b64ToHex(q.get('s') || '');
  if (!isHash(salt)) throw new Error('Link has no valid salt');
  const fields = normalizeFields(JSON.parse(new TextDecoder().decode(b64urlDecode(q.get('f') || ''))));
  const packed = b64urlDecode(q.get('p') || '');
  if (packed.length % 32) throw new Error('Malformed proof');
  const proof = [];
  for (let k = 0; k < packed.length; k += 32) proof.push(toHex(packed.subarray(k, k + 32)));
  const pdfHash = q.get('h') ? b64ToHex(q.get('h')) : null;
  if (pdfHash && !isHash(pdfHash)) throw new Error('Malformed PDF hash');
  return { network, txHash, index, salt, fields, proof, pdfHash };
}

export function buildVerifyUrl(verifyPageUrl, payload) {
  return verifyPageUrl.replace(/#.*$/, '') + '#' + encodeFragment(payload);
}

/** Accept a full URL, a bare fragment, or whatever a QR scanner returned. */
export function looksLikeVerifyLink(text) {
  return /[#&]?n=(mainnet|preprod|preview)&tx=[0-9a-fA-F]{64}/.test(String(text || ''));
}
