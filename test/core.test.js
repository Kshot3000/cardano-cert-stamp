import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalFields, certificateDigest, validateFields, fileSha256, newSalt } from '../src/lib/certificate.js';
import { encodeFragment, decodeFragment, buildVerifyUrl, looksLikeVerifyLink } from '../src/lib/link.js';
import { prepareBatch, parseCsv, backupCsv, publicBatchJson } from '../src/lib/batch.js';
import { verifyInclusion } from '../src/lib/merkle.js';
import { paymentCredential, addressMatchesNetwork, networkId } from '../src/lib/address.js';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const F = { cert_no: 'WLD-0001', recipient_name: 'Ada Lovelace', course: 'Welding Level 1', date_awarded: '2026-11-10', issuer: 'Demo Trade School' };
const SALT = '11'.repeat(32);

describe('certificate digest', () => {
  it('matches an independent SHA-256 of "kshot-cert-v1" || salt || canonical JSON', async () => {
    const json = canonicalFields(F);
    expect(json).toBe('{"cert_no":"WLD-0001","course":"Welding Level 1","date_awarded":"2026-11-10","issuer":"Demo Trade School","recipient_name":"Ada Lovelace"}');
    const expected = sha(Buffer.concat([Buffer.from('kshot-cert-v1'), Buffer.from(SALT, 'hex'), Buffer.from(json)]));
    expect(await certificateDigest(F, SALT)).toBe(expected);
  });
  it('appends the PDF hash when given', async () => {
    const pdf = sha('pdf');
    const expected = sha(Buffer.concat([Buffer.from('kshot-cert-v1'), Buffer.from(SALT, 'hex'), Buffer.from(canonicalFields(F)), Buffer.from(pdf, 'hex')]));
    expect(await certificateDigest(F, SALT, pdf)).toBe(expected);
  });
  it('is stable under key order, spacing and Unicode form', async () => {
    const a = { ...F, recipient_name: 'José  Núñez' };
    const b = { issuer: F.issuer, date_awarded: F.date_awarded, course: ' Welding Level 1 ', cert_no: F.cert_no, recipient_name: 'Jose\u0301 Nu\u0301n\u0303ez', grade: '' };
    expect(await certificateDigest(a, SALT)).toBe(await certificateDigest(b, SALT));
  });
  it('changes when any field or the salt changes', async () => {
    const h = await certificateDigest(F, SALT);
    for (const k of Object.keys(F)) expect(await certificateDigest({ ...F, [k]: k === 'date_awarded' ? '2026-11-11' : F[k] + 'x' }, SALT)).not.toBe(h);
    expect(await certificateDigest({ ...F, grade: 'A' }, SALT)).not.toBe(h);
    expect(await certificateDigest(F, '22'.repeat(32))).not.toBe(h);
  });
  it('generates fresh 32-byte salts', () => {
    const a = newSalt(), b = newSalt();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
  it('validates fields', () => {
    expect(validateFields(F)).toEqual([]);
    expect(validateFields({ ...F, date_awarded: '11/10/2026' })).toContain('date_awarded must be YYYY-MM-DD');
    expect(validateFields({ ...F, email: 'x' })).toContain('unknown field email');
    expect(validateFields({ course: 'x' }).length).toBeGreaterThan(2);
  });
  it('hashes files byte-for-byte', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 demo');
    expect(await fileSha256(bytes)).toBe(sha(Buffer.from(bytes)));
  });
});

describe('batch + verify links', () => {
  it('every certificate in a batch round-trips through its link and verifies against the root', async () => {
    const items = Array.from({ length: 13 }, (_, i) => ({ fields: { ...F, cert_no: 'WLD-' + i, recipient_name: 'Student ' + i } }));
    const b = await prepareBatch(items, { title: 'Welding L1 Nov 2026' });
    expect(b.count).toBe(13);
    expect(b.metadata[674]).toEqual({ msg: ['Welding L1 Nov 2026'], app: 'kshot-cert-stamp' });
    for (const e of b.entries) {
      const url = buildVerifyUrl('https://example.org/app/verify.html', { network: 'preprod', txHash: 'c'.repeat(64), index: e.index, salt: e.salt, fields: e.fields, proof: e.proof });
      expect(looksLikeVerifyLink(url)).toBe(true);
      const d = decodeFragment(url);
      expect(d.fields).toEqual(e.fields);
      const dd = await certificateDigest(d.fields, d.salt, d.pdfHash);
      expect(await verifyInclusion(dd, d.index, b.count, d.proof, b.root)).toBe(true);
    }
  });
  it('reports bad rows clearly', async () => {
    await expect(prepareBatch([{ fields: F }, { fields: { ...F, course: '' } }])).rejects.toThrow('Row 2: course is required');
  });
  it('keeps a 500-certificate link QR-sized (under 900 chars)', async () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ fields: { ...F, cert_no: 'WLD-' + i, issuer_addr: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae' } }));
    const b = await prepareBatch(items);
    const e = b.entries[499];
    const url = buildVerifyUrl('https://kshot3000.github.io/cardano-cert-stamp/verify.html', { network: 'preprod', txHash: 'c'.repeat(64), index: e.index, salt: e.salt, fields: e.fields, proof: e.proof });
    expect(url.length).toBeLessThan(900);
  });
  it('reads the network from the link (mainnet too) and refuses unknown networks', () => {
    const p = { network: 'mainnet', txHash: 'c'.repeat(64), index: 0, salt: SALT, fields: F, proof: [] };
    expect(decodeFragment(encodeFragment(p)).network).toBe('mainnet');
    expect(() => encodeFragment({ ...p, network: 'sanchonet' })).toThrow();
    expect(() => decodeFragment('n=guildnet&tx=' + 'c'.repeat(64))).toThrow();
    expect(() => decodeFragment('n=preprod&tx=abc')).toThrow();
    expect(looksLikeVerifyLink('hello')).toBe(false);
  });
  it('backup CSV holds salts; public batch.json holds no names', async () => {
    const b = await prepareBatch([{ fields: F }, { fields: { ...F, cert_no: 'WLD-2', recipient_name: 'Grace, "Amazing" Hopper' } }]);
    const csv = backupCsv(b, 'c'.repeat(64), 'preprod', () => 'https://x/verify.html#...');
    expect(csv).toContain(b.entries[0].salt);
    expect(csv).toContain('"Grace, ""Amazing"" Hopper"');
    const pub = publicBatchJson(b, 'c'.repeat(64), 'preprod');
    expect(pub).not.toContain('Ada');
    expect(pub).not.toContain(b.entries[0].salt);
    expect(JSON.parse(pub).cip190.root).toBe(b.root);
  });
});

describe('csv', () => {
  it('parses headers, aliases, quotes and BOM', () => {
    const rows = parseCsv('\uFEFFcert_no,Name,course,date\nA1,"Lovelace, Ada",Welding I,2026-11-10\n\nA2,Grace,"CPR ""Basic""",2026-11-11\n');
    expect(rows).toEqual([
      { cert_no: 'A1', recipient_name: 'Lovelace, Ada', course: 'Welding I', date_awarded: '2026-11-10' },
      { cert_no: 'A2', recipient_name: 'Grace', course: 'CPR "Basic"', date_awarded: '2026-11-11' },
    ]);
  });
  it('drops columns it does not know (e.g. email), so they never get hashed or stored', () => {
    expect(parseCsv('cert_no,recipient_name,course,date_awarded,email\nA,B,C,2026-01-01,x@y')).toEqual([{ cert_no: 'A', recipient_name: 'B', course: 'C', date_awarded: '2026-01-01' }]);
  });
});

describe('addresses', () => {
  it('extracts the payment credential (CIP-19 test vector) and rejects junk', () => {
    const a = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae';
    expect(paymentCredential(a)).toBe('9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e');
    expect(paymentCredential(a.slice(0, -1) + 'x')).toBeNull();
    expect(paymentCredential('stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw')).toBeNull();
  });
  it('checks addr vs addr_test against the chosen network', () => {
    const test = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae';
    const main = 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x'; // CIP-19 mainnet vector
    expect(addressMatchesNetwork(test, 'preprod')).toBe(true);
    expect(addressMatchesNetwork(test, 'mainnet')).toBe(false);
    expect(addressMatchesNetwork(main, 'mainnet')).toBe(true);
    expect(addressMatchesNetwork(main, 'preview')).toBe(false);
    expect(addressMatchesNetwork('addr1junk', 'mainnet')).toBe(false);
    expect([networkId('mainnet'), networkId('preprod'), networkId('preview')]).toEqual([1, 0, 0]);
  });
  it('rejects an invalid issuer_addr on a certificate', () => {
    expect(validateFields({ ...F, issuer_addr: 'addr1nope' })).toContain('issuer_addr is not a valid Cardano address');
  });
});
