import { describe, it, expect, vi, afterEach } from 'vitest';
import worker, { spendingInputs } from '../worker/index.js';

const H = 'e'.repeat(64);
afterEach(() => vi.unstubAllGlobals());

describe('worker proxy', () => {
  it('proxies tx_info for one hash with CORS for allowed origins', async () => {
    const fetchMock = vi.fn(async () => new Response('[{"tx_hash":"x"}]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const req = new Request(`https://w.example/preprod/api/v1/tx_info?_tx_hashes=%7B${H}%7D&_inputs=true&_metadata=true`, { headers: { origin: 'https://kshot3000.github.io' } });
    const res = await worker.fetch(req, { ALLOWED_ORIGINS: 'https://kshot3000.github.io', KOIOS_TOKEN: 't' });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://kshot3000.github.io');
    expect(fetchMock.mock.calls[0][0]).toBe(`https://preprod.koios.rest/api/v1/tx_info?_tx_hashes=%7B${H}%7D&_inputs=true&_metadata=true`);
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer t');
  });
  it('refuses anything else', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const env = {};
    expect((await worker.fetch(new Request('https://w.example/preprod/api/v1/address_info?x=1'), env)).status).toBe(400);
    expect((await worker.fetch(new Request(`https://w.example/sancho/api/v1/tx_info?_tx_hashes=%7B${H}%7D`), env)).status).toBe(400);
    expect((await worker.fetch(new Request('https://w.example/preprod/api/v1/tx_info', { method: 'POST' }), env)).status).toBe(405);
  });
  it('CORS is deny-by-default: unlisted origins and an empty/unset list get no CORS and a 403', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const url = `https://w.example/preprod/api/v1/tx_info?_tx_hashes=%7B${H}%7D`;
    for (const env of [{}, { ALLOWED_ORIGINS: '' }, { ALLOWED_ORIGINS: ' , ' }, { ALLOWED_ORIGINS: 'https://kshot3000.github.io' }]) {
      const res = await worker.fetch(new Request(url, { headers: { origin: 'https://evil.example' } }), env);
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      const pre = await worker.fetch(new Request(url, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env);
      expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    }
    const unset = await worker.fetch(new Request(url, { headers: { origin: 'https://kshot3000.github.io' } }), {});
    expect(unset.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    // no Origin header (curl / native app): allowed, no CORS headers needed
    const native = await worker.fetch(new Request(url), {});
    expect(native.status).toBe(200);
  });
  it('wrangler.toml default allows GitHub Pages and localhost only', async () => {
    const { readFileSync } = await import('node:fs');
    const toml = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8');
    const origins = toml.match(/ALLOWED_ORIGINS = "([^"]*)"/)[1].split(',');
    expect(origins).toContain('https://kshot3000.github.io');
    expect(origins.every((o) => o === 'https://kshot3000.github.io' || /^https?:\/\/localhost(:\d+)?$/.test(o))).toBe(true);
  });
  it('Blockfrost path only reports spending inputs (no reference or collateral inputs)', () => {
    const utxos = { inputs: [
      { address: 'addr_test1spender', reference: false, collateral: false },
      { address: 'addr_test1school', reference: true, collateral: false },
      { address: 'addr_test1coll', reference: false, collateral: true },
    ] };
    expect(spendingInputs(utxos).map((i) => i.address)).toEqual(['addr_test1spender']);
    expect(spendingInputs(null)).toEqual([]);
  });
  it('fails over to Blockfrost and reshapes the label-309 chunks', async () => {
    const chunkHex = '8241aa42bbcc'; // [h'aa', h'bbcc']
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('koios')) return new Response('down', { status: 503 });
      if (url.endsWith('/utxos')) return Response.json({ inputs: [{ address: 'addr_test1xyz' }, { address: 'addr_test1school', reference: true }, { address: 'addr_test1coll', collateral: true }] });
      if (url.endsWith('/metadata/cbor')) return Response.json([{ label: '309', metadata: chunkHex }]);
      return Response.json({ block_height: 5, block_time: 1700000000 });
    }));
    const res = await worker.fetch(new Request(`https://w.example/preprod/api/v1/tx_info?_tx_hashes=%7B${H}%7D`), { BLOCKFROST_PREPROD: 'p' });
    const rows = await res.json();
    expect(rows[0].metadata['309']).toEqual(['0xaa', '0xbbcc']);
    expect(rows[0].inputs.map((i) => i.payment_addr.bech32)).toEqual(['addr_test1xyz']);
  });
});
