// Our CBOR, RFC 9162 Merkle and label-309 carriage code against the official
// CIP-190 conformance vectors (cardanowall/label-309, Apache-2.0).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { encode, decode } from '../src/lib/cbor.js';
import { buildTree, getProof, verifyInclusion } from '../src/lib/merkle.js';
import { reassemble, chunk, buildRecordBody, parseRecord, buildStampMetadata, LABEL, EXT } from '../src/lib/record.js';
import { toHex, fromHex } from '../src/lib/hash.js';

const vec = (f) => JSON.parse(readFileSync(new URL('./vectors/' + f, import.meta.url)));

describe('canonical CBOR (RFC 8949 KATs)', () => {
  for (const v of vec('canonical-encode-rfc8949-kat.json').vectors) {
    it(v.name, () => {
      const input = v.input_value_spec?.type === 'bytes' ? fromHex(v.input_value_spec.hex) : JSON.parse(v.input_json);
      if (v.input_value_spec && v.input_value_spec.type !== 'bytes') return; // other typed specs not used by us
      const out = toHex(encode(input));
      expect(out).toBe(v.expected_cbor_hex);
      const back = decode(fromHex(out));
      expect(back instanceof Uint8Array ? toHex(back) : back).toEqual(input instanceof Uint8Array ? toHex(input) : input);
    });
  }
  it('rejects non-canonical input', () => {
    expect(() => decode(fromHex('1817'))).toThrow(); // non-minimal
    expect(() => decode(fromHex('a2616201616102'))).toThrow(); // unsorted keys
    expect(() => decode(fromHex('9f01ff'))).toThrow(); // indefinite
    expect(() => decode(fromHex('f93c00'))).toThrow(); // float
    expect(() => decode(fromHex('0101'))).toThrow(); // trailing
    expect(() => encode(1.5)).toThrow();
  });
});

describe('rfc9162-sha256 root KATs', () => {
  for (const v of vec('rfc9162-sha256-root-kat.json').vectors) {
    it(v.name, async () => {
      expect((await buildTree(v.leaves)).root).toBe(v.root);
    });
  }
});

describe('rfc9162-sha256 inclusion proof KATs', () => {
  for (const t of vec('rfc9162-sha256-inclusion-proof-kat.json').trees) {
    it(t.name, async () => {
      const tree = await buildTree(t.leaves);
      expect(tree.root).toBe(t.root);
      for (const inc of t.inclusions) {
        expect(getProof(tree, inc.index)).toEqual(inc.proof);
        expect(await verifyInclusion(inc.leaf, inc.index, t.tree_size, inc.proof, t.root)).toBe(true);
      }
    });
  }
});

describe('merkle edge cases', () => {
  const leaves = (n) => Array.from({ length: n }, (_, i) => (i + 1).toString(16).padStart(4, '0').repeat(16));
  for (const n of [1, 2, 3, 6, 9, 31, 100, 257]) {
    it(`all proofs verify, and only at the right index, n=${n}`, async () => {
      const L = leaves(n), t = await buildTree(L);
      for (let i = 0; i < n; i++) {
        const p = getProof(t, i);
        expect(await verifyInclusion(L[i], i, n, p, t.root)).toBe(true);
        if (n > 1) expect(await verifyInclusion(L[i], (i + 1) % n, n, p, t.root)).toBe(false);
      }
    });
  }
  it('rejects tampered proofs and out-of-range indexes', async () => {
    const L = leaves(7), t = await buildTree(L), p = getProof(t, 3);
    expect(await verifyInclusion(L[3], 3, 7, [p[0], 'f'.repeat(64), p[2]], t.root)).toBe(false);
    expect(await verifyInclusion(L[3], 3, 7, p.slice(0, 2), t.root)).toBe(false);
    expect(await verifyInclusion(L[3], 7, 7, p, t.root)).toBe(false);
    expect(await verifyInclusion(L[6], 6, 7, getProof(t, 6), t.root)).toBe(true);
    expect(await verifyInclusion(L[6], 6, 9, getProof(t, 6), t.root)).toBe(false); // tree size comes from chain
    expect(await verifyInclusion(L[4], 3, 7, p, t.root)).toBe(false);
  });
});

describe('label 309 carriage', () => {
  for (const v of vec('chunk-array-positive.json').vectors) {
    it(v.name, () => {
      const arr = decode(fromHex(v.label_309_value_cbor_hex));
      expect(toHex(reassemble(arr))).toBe(v.expected_record_body_hex);
    });
  }
  it('our record body chunks minimally and round-trips', () => {
    const root = 'ab'.repeat(32);
    const body = buildRecordBody(root, 500);
    const chunks = chunk(body);
    expect(chunks.every((c) => c.length <= 64)).toBe(true);
    expect(chunks.slice(0, -1).every((c) => c.length === 64)).toBe(true);
    expect(decode(body)).toEqual({ v: 1, merkle: [{ alg: 'rfc9162-sha256', root: fromHex(root), leaf_count: 500 }], 'x-kshot': EXT });
    expect(EXT).toEqual({ kind: 'cert-batch', ver: 1, app: 'kshot-cert-stamp', app_ver: '0.1.0' });
    // Koios reports metadata byte strings as "0x..." hex
    const koiosShape = { [LABEL]: chunks.map((c) => '0x' + toHex(c)) };
    expect(parseRecord(koiosShape)).toEqual({ merkle: [{ root, leafCount: 500 }], ext: EXT });
  });
  it('rejects oversize chunks, foreign label-309 data, and unknown fields', () => {
    expect(() => reassemble([new Uint8Array(65)])).toThrow('CHUNK_TOO_LARGE');
    expect(parseRecord({ 309: { status: 'Claiming rewards tokens', stakePoolId: 0 } })).toBeNull();
    const bad = encode({ v: 1, merkle: [{ alg: 'rfc9162-sha256', root: new Uint8Array(32), leaf_count: 1 }], junk: 1 });
    expect(parseRecord({ 309: chunk(bad) })).toBeNull();
    const other = encode({ v: 1, merkle: [{ alg: 'something-else', root: new Uint8Array(32), leaf_count: 1 }] });
    expect(parseRecord({ 309: chunk(other) })).toBeNull();
  });
  it('674 memo carries the app id and an optional public title (max 64 bytes)', () => {
    expect(buildStampMetadata('ab'.repeat(32), 3)[674]).toEqual({ msg: ['Certificate batch'], app: 'kshot-cert-stamp' });
    expect(buildStampMetadata('ab'.repeat(32), 3, 'Welding L1, Dec 2026')[674]).toEqual({ msg: ['Welding L1, Dec 2026'], app: 'kshot-cert-stamp' });
    expect(() => buildStampMetadata('ab'.repeat(32), 3, 'x'.repeat(65))).toThrow();
  });
});
