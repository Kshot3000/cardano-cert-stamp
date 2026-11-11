// Offline check that the stamp transaction builds and carries our metadata.
// Uses a throwaway in-memory key; nothing is submitted anywhere.
import { describe, it, expect } from 'vitest';
import { MeshWallet } from '@meshsdk/core';
import { buildStampTx } from '../src/lib/stamp.js';
import { buildStampMetadata, parseRecord } from '../src/lib/record.js';
import { deserializeTx } from '@meshsdk/core-cst';

describe('stamp transaction', () => {
  it('builds a testnet tx carrying the CIP-190 label-309 record and 674 memo', async () => {
    const words = MeshWallet.brew();
    const w = new MeshWallet({ networkId: 0, key: { type: 'mnemonic', words } });
    await w.init();
    const addr = await w.getChangeAddress();
    expect(addr.startsWith('addr_test1')).toBe(true);
    const utxos = [{
      input: { txHash: 'a'.repeat(64), outputIndex: 0 },
      output: { address: addr, amount: [{ unit: 'lovelace', quantity: '10000000' }] },
    }];
    const md = buildStampMetadata('b'.repeat(64), 25, 'Demo batch');
    const hex = await buildStampTx({ utxos, changeAddress: addr, metadata: md });
    const tx = deserializeTx(hex);
    const blob = tx.auxiliaryData().toCore().blob;
    const chunks = blob.get(309n);
    expect(chunks.map((c) => Buffer.from(c).toString('hex'))).toEqual(md[309].map((c) => Buffer.from(c).toString('hex')));
    expect(parseRecord({ 309: chunks })).toEqual({ merkle: [{ root: 'b'.repeat(64), leafCount: 25 }], ext: { kind: 'cert-batch', ver: 1, app: 'kshot-cert-stamp', app_ver: '0.1.0' } });
    expect(blob.get(674n).get('msg')).toEqual(['Demo batch']);
    expect(blob.get(674n).get('app')).toBe('kshot-cert-stamp');
    const fee = Number(tx.body().fee());
    expect(fee).toBeGreaterThan(150000);
    expect(fee).toBeLessThan(250000); // ~0.17-0.2 tADA
    const signed = await w.signTx(hex);
    expect(signed.length).toBeGreaterThan(hex.length);
  });
});
