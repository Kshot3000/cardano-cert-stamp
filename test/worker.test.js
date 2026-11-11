import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../worker/index.js';

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
    expect((await worker.fetch(new Request(`https://w.example/preprod/api/v1/tx_info?_tx_hashes=%7B${H}%7D`, { headers: { origin: 'https://evil.example' } }), { ALLOWED_ORIGINS: 'https://kshot3000.github.io' })).headers.get('access-control-allow-origin')).toBe('null');
  });
  it('fails over to Blockfrost and reshapes the label-309 chunks', async () => {
    const chunkHex = '8241aa42bbcc'; // [h'aa', h'bbcc']
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.includes('koios')) return new Response('down', { status: 503 });
      if (url.endsWith('/utxos')) return Response.json({ inputs: [{ address: 'addr_test1xyz' }] });
      if (url.endsWith('/metadata/cbor')) return Response.json([{ label: '309', metadata: chunkHex }]);
      return Response.json({ block_height: 5, block_time: 1700000000 });
    }));
    const res = await worker.fetch(new Request(`https://w.example/preprod/api/v1/tx_info?_tx_hashes=%7B${H}%7D`), { BLOCKFROST_PREPROD: 'p' });
    const rows = await res.json();
    expect(rows[0].metadata['309']).toEqual(['0xaa', '0xbbcc']);
    expect(rows[0].inputs[0].payment_addr.bech32).toBe('addr_test1xyz');
  });
});
