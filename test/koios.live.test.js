// Live read against the public Koios Preprod API (no key). Skipped unless LIVE=1.
import { describe, it, expect } from 'vitest';
import { fetchTx } from '../src/lib/indexer.js';
const run = process.env.LIVE ? it : it.skip;
describe('koios live', () => {
  run('reads a known Preprod tx with metadata and inputs', async () => {
    const r = await fetchTx('preprod', '8e70e0ec964be7eb970d429ab65995858b1c8ee9befc06e47339dc920df9cb72', { allowPublicRelay: false });
    expect(r.tx.metadata['674']).toBeTruthy();
    expect(r.tx.inputs[0].address.startsWith('addr_test1')).toBe(true);
  }, 20000);
  run('returns no tx for a hash that does not exist', async () => {
    const r = await fetchTx('preprod', '0'.repeat(64), { allowPublicRelay: false });
    expect(r.tx).toBeNull();
  }, 20000);
});
