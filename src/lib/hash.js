// SHA-256 helpers built on WebCrypto (browser, Android WebView and Node 20+).
const subtle = globalThis.crypto && globalThis.crypto.subtle;

export async function sha256(bytes) {
  if (!subtle) throw new Error('WebCrypto is not available in this environment');
  const buf = await subtle.digest('SHA-256', bytes);
  return new Uint8Array(buf);
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex) {
  if (typeof hex !== 'string' || !/^([0-9a-fA-F]{2})*$/.test(hex)) throw new Error('Invalid hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function isHash(hex) {
  return typeof hex === 'string' && /^[0-9a-f]{64}$/.test(hex);
}

export async function sha256Hex(bytes) {
  return toHex(await sha256(bytes));
}

export function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function randomHex(nBytes) {
  const b = new Uint8Array(nBytes);
  globalThis.crypto.getRandomValues(b);
  return toHex(b);
}
