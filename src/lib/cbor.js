// Minimal deterministic CBOR (RFC 8949 §4.2.1 core deterministic encoding),
// enough for CIP-190 label-309 record bodies: unsigned/negative ints, byte
// strings, text strings, arrays, maps, true/false/null. Floats and tags are
// rejected, as CIP-190's canonical profile requires.

function head(major, n) {
  if (n < 0 || !Number.isSafeInteger(n)) throw new Error('CBOR: integer out of range');
  const m = major << 5;
  if (n < 24) return [m | n];
  if (n < 0x100) return [m | 24, n];
  if (n < 0x10000) return [m | 25, n >> 8, n & 0xff];
  if (n < 0x100000000) return [m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const hi = Math.floor(n / 0x100000000), lo = n >>> 0;
  return [m | 27, (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff, (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff];
}

function cmpBytes(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

function enc(v, out) {
  if (v === null) out.push(0xf6);
  else if (v === false) out.push(0xf4);
  else if (v === true) out.push(0xf5);
  else if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('CBOR: floats are not allowed');
    if (v >= 0) out.push(...head(0, v)); else out.push(...head(1, -1 - v));
  } else if (typeof v === 'string') {
    const b = new TextEncoder().encode(v);
    out.push(...head(3, b.length)); for (const x of b) out.push(x);
  } else if (v instanceof Uint8Array) {
    out.push(...head(2, v.length)); for (const x of v) out.push(x);
  } else if (Array.isArray(v)) {
    out.push(...head(4, v.length)); for (const x of v) enc(x, out);
  } else if (typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [encode(k), x]);
    entries.sort((a, b) => cmpBytes(a[0], b[0]));
    out.push(...head(5, entries.length));
    for (const [k, x] of entries) { for (const b of k) out.push(b); enc(x, out); }
  } else throw new Error('CBOR: unsupported value');
}

export function encode(v) {
  const out = [];
  enc(v, out);
  return Uint8Array.from(out);
}

/** Strict decoder: rejects indefinite lengths, non-minimal heads, floats, tags, trailing bytes, unsorted/duplicate map keys. */
export function decode(bytes) {
  let p = 0;
  const need = (n) => { if (p + n > bytes.length) throw new Error('CBOR: truncated'); };
  function readHead() {
    need(1);
    const ib = bytes[p++], major = ib >> 5, ai = ib & 31;
    let n;
    if (ai < 24) n = ai;
    else if (ai === 24) { need(1); n = bytes[p++]; if (n < 24) throw new Error('CBOR: non-minimal'); }
    else if (ai === 25) { need(2); n = (bytes[p] << 8) | bytes[p + 1]; p += 2; if (n < 0x100) throw new Error('CBOR: non-minimal'); }
    else if (ai === 26) { need(4); n = ((bytes[p] << 24) >>> 0) + (bytes[p + 1] << 16) + (bytes[p + 2] << 8) + bytes[p + 3]; p += 4; if (n < 0x10000) throw new Error('CBOR: non-minimal'); }
    else if (ai === 27) { need(8); let hi = ((bytes[p] << 24) >>> 0) + (bytes[p + 1] << 16) + (bytes[p + 2] << 8) + bytes[p + 3]; let lo = ((bytes[p + 4] << 24) >>> 0) + (bytes[p + 5] << 16) + (bytes[p + 6] << 8) + bytes[p + 7]; p += 8; n = hi * 0x100000000 + lo; if (!Number.isSafeInteger(n)) throw new Error('CBOR: integer too large'); if (n < 0x100000000) throw new Error('CBOR: non-minimal'); }
    else throw new Error('CBOR: indefinite or reserved length');
    return { major, ai, n };
  }
  function item() {
    const start = p;
    const { major, ai, n } = readHead();
    switch (major) {
      case 0: return n;
      case 1: return -1 - n;
      case 2: need(n); p += n; return bytes.slice(p - n, p);
      case 3: need(n); p += n; return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(p - n, p));
      case 4: { const a = []; for (let i = 0; i < n; i++) a.push(item()); return a; }
      case 5: {
        const o = {}; let prev = null;
        for (let i = 0; i < n; i++) {
          const ks = p; const k = item();
          if (typeof k !== 'string') throw new Error('CBOR: only text map keys supported');
          const kb = bytes.subarray(ks, p);
          if (prev && cmpBytes(prev, kb) >= 0) throw new Error('CBOR: map keys not in canonical order');
          prev = kb; o[k] = item();
        }
        return o;
      }
      case 6: throw new Error('CBOR: tags not allowed');
      case 7:
        if (ai === 20) return false; if (ai === 21) return true; if (ai === 22) return null;
        throw new Error('CBOR: floats/simple values not allowed');
    }
    throw new Error('CBOR: bad item at ' + start);
  }
  const v = item();
  if (p !== bytes.length) throw new Error('CBOR: trailing bytes');
  return v;
}
