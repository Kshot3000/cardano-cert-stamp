import { describe, it, expect } from 'vitest';
import { verifyCertificate } from '../src/lib/verify.js';
import { prepareBatch } from '../src/lib/batch.js';
import { fetchTx, normalizeTxInfo, sourcesFor } from '../src/lib/indexer.js';
import { toHex } from '../src/lib/hash.js';

const ADDR = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae';
const CRED = '9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e';
const TX = 'd'.repeat(64);
const F = (i) => ({ cert_no: 'H-' + i, recipient_name: 'S' + i, course: 'HVAC', date_awarded: '2026-11-10', issuer: 'Demo', issuer_addr: ADDR });

async function setup(n = 5) {
  const b = await prepareBatch(Array.from({ length: n }, (_, i) => ({ fields: F(i) })));
  const koiosMd = { 309: b.metadata[309].map((c) => '0x' + toHex(c)) };
  const row = { tx_hash: TX, block_height: 1, tx_timestamp: 1700000000, metadata: koiosMd, inputs: [{ payment_addr: { bech32: ADDR, cred: CRED } }] };
  return { b, row, stub: (r = row) => async () => ({ source: 'stub', tx: normalizeTxInfo(r) }) };
}
const linkOf = (e, extra = {}) => ({ network: 'preprod', txHash: TX, index: e.index, salt: e.salt, fields: e.fields, proof: e.proof, pdfHash: e.pdfHash, ...extra });

describe('verifyCertificate', () => {
  it('valid, and matches the issuer wallet printed on the certificate', async () => {
    const { b, stub } = await setup();
    const r = await verifyCertificate(linkOf(b.entries[4]), { fetchTx: stub() });
    expect(r.status).toBe('valid');
    expect(r.issuer).toBe('printed');
    expect(r.batchSize).toBe(5);
    expect(r.explorerUrl).toBe('https://preprod.cardanoscan.io/transaction/' + TX);
  });
  it('registry issuer wins when the signer is listed in issuers.json', async () => {
    const { b, stub } = await setup();
    const r = await verifyCertificate(linkOf(b.entries[0]), { fetchTx: stub(), issuers: [{ name: 'Demo', network: 'preprod', address: ADDR }] });
    expect(r.issuer).toBe('registry');
  });
  it('an edited certificate is a mismatch', async () => {
    const { b, stub } = await setup();
    const e = b.entries[1];
    expect((await verifyCertificate(linkOf(e, { fields: { ...e.fields, course: 'HVAC Master' } }), { fetchTx: stub() })).status).toBe('mismatch');
    expect((await verifyCertificate(linkOf(e, { index: 2 }), { fetchTx: stub() })).status).toBe('mismatch');
  });
  it('flags a stamp signed by a different wallet than printed', async () => {
    const { b, row, stub } = await setup();
    const r = await verifyCertificate(linkOf(b.entries[0]), { fetchTx: stub({ ...row, inputs: [{ payment_addr: { bech32: 'addr_test1other', cred: 'f'.repeat(56) } }] }) });
    expect(r.status).toBe('valid');
    expect(r.issuer).toBe('no_match');
  });
  it('PDF-bound certificates need the matching PDF hash', async () => {
    const b = await prepareBatch([{ fields: F(0), pdfHash: 'a'.repeat(64) }]);
    const row = { tx_hash: TX, metadata: { 309: b.metadata[309].map((c) => '0x' + toHex(c)) }, inputs: [] };
    const st = async () => ({ source: 's', tx: normalizeTxInfo(row) });
    expect((await verifyCertificate(linkOf(b.entries[0]), { fetchTx: st })).status).toBe('valid');
    expect((await verifyCertificate(linkOf(b.entries[0], { pdfHash: 'b'.repeat(64) }), { fetchTx: st })).status).toBe('mismatch');
  });
  it('unknown tx -> not_found; non-stamp tx -> mismatch; offline -> error', async () => {
    const { b } = await setup();
    const l = linkOf(b.entries[0]);
    expect((await verifyCertificate(l, { fetchTx: async () => ({ source: 's', tx: null }) })).status).toBe('not_found');
    expect((await verifyCertificate(l, { fetchTx: async () => ({ source: 's', tx: { metadata: { 674: {} }, inputs: [] } }) })).status).toBe('mismatch');
    expect((await verifyCertificate(l, { fetchTx: async () => { throw new Error('offline'); } })).status).toBe('error');
  });
});

describe('indexer sources', () => {
  it('worker first, then Koios, then the public relay; relay can be disabled', () => {
    expect(sourcesFor('preprod', { workerBase: 'https://w.example/' }).map((s) => s.source)).toEqual(['Worker proxy', 'Koios', 'Koios via proxy.cors.dev']);
    expect(sourcesFor('preprod', { allowPublicRelay: false }).map((s) => s.source)).toEqual(['Koios']);
    expect(sourcesFor('mainnet', { allowPublicRelay: false })[0].base).toBe('https://api.koios.rest/api/v1');
    expect(() => sourcesFor('sanchonet')).toThrow();
  });
  it('falls back when a source fails', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (!url.startsWith('https://proxy.cors.dev/')) throw new TypeError('Failed to fetch');
      return { ok: true, json: async () => [{ tx_hash: TX, inputs: [], metadata: null }] };
    };
    const r = await fetchTx('preprod', TX, { fetchImpl });
    expect(r.source).toBe('Koios via proxy.cors.dev');
    expect(calls[0]).toBe(`https://preprod.koios.rest/api/v1/tx_info?_tx_hashes=%7B${TX}%7D&_inputs=true&_metadata=true`);
  });
});
