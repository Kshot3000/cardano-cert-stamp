import { describe, it, expect } from 'vitest';
import { presentResult } from '../src/lib/present.js';

const fields = { issuer: 'Acme Trade School', recipient_name: 'S', course: 'C', date_awarded: '2026-11-10', cert_no: '1' };
const valid = (extra) => ({ status: 'valid', network: 'preprod', ...extra });

describe('verify result presentation', () => {
  it('only a registry issuer gets "Valid certificate · Issued by"', () => {
    const v = presentResult(valid({ issuer: 'registry', registryEntry: { name: 'Acme Trade School', network: 'preprod' } }), fields);
    expect(v.heading).toBe('Valid certificate · Issued by Acme Trade School');
    expect(v.icon).toBe('✅');
    expect(v.issuerVerified).toBe(true);
  });
  it('uses the registry name, not the self-declared one', () => {
    const v = presentResult(valid({ issuer: 'registry', registryEntry: { name: 'Real Name College' } }), { ...fields, issuer: 'Typed Name' });
    expect(v.heading).toBe('Valid certificate · Issued by Real Name College');
  });
  for (const issuer of ['printed', 'unknown', 'no_match']) {
    it(`"${issuer}" leads with "Stamp found, issuer not verified" and marks the name self-declared`, () => {
      const v = presentResult(valid({ issuer }), fields);
      expect(v.heading).toBe('Stamp found, issuer not verified');
      expect(v.heading).not.toMatch(/Valid|Issued by/);
      expect(v.icon).not.toBe('✅');
      expect(v.issuerVerified).toBe(false);
      expect(v.issuerLabel).toBe('Acme Trade School (self-declared, not verified)');
      expect(v.issuerNote).toMatch(/can't confirm who issued it/);
    });
  }
  it('a registry flag without an entry is not trusted', () => {
    expect(presentResult(valid({ issuer: 'registry', registryEntry: null }), fields).issuerVerified).toBe(false);
  });
  it('non-valid results never claim an issuer', () => {
    for (const status of ['not_found', 'mismatch', 'error']) {
      const v = presentResult({ status }, fields);
      expect(v.issuerVerified).toBe(false);
      expect(v.heading).not.toMatch(/Issued by/);
      expect(v.issuerLabel).toMatch(/self-declared/);
    }
  });
});
