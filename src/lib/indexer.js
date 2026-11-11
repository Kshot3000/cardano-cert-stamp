// Read-only chain lookups. No API key is ever shipped in this code.
//
// Sources, tried in order:
//  1. A Worker proxy, if config.js sets one (see worker/). It holds any Koios
//     or Blockfrost key in Cloudflare env vars and adds CORS headers.
//  2. Koios directly. Works from Node, from the Android app (Capacitor's
//     native HTTP isn't subject to browser CORS) and from any browser once
//     Koios sends CORS headers. Koios's no-key public tier currently leaves
//     Access-Control-Allow-Origin off responses, so browsers block it.
//  3. Optional public CORS relay (proxy.cors.dev). It only sees a public tx
//     hash, but a relay could in theory lie, so the UI always says which source
//     answered and links the tx on an explorer for an independent check.
//     Disable it with config.allowPublicRelay = false.
export const KOIOS = {
  mainnet: 'https://api.koios.rest/api/v1',
  preprod: 'https://preprod.koios.rest/api/v1',
  preview: 'https://preview.koios.rest/api/v1',
};
export const EXPLORER = {
  mainnet: 'https://cardanoscan.io/transaction/',
  preprod: 'https://preprod.cardanoscan.io/transaction/',
  preview: 'https://preview.cardanoscan.io/transaction/',
};
export const PUBLIC_RELAY = 'https://proxy.cors.dev/';

const txInfoPath = (txHash) => `/tx_info?_tx_hashes=%7B${txHash}%7D&_inputs=true&_metadata=true`;

export function sourcesFor(network, { workerBase = '', allowPublicRelay = true, koios = KOIOS } = {}) {
  const k = koios[network];
  if (!k) throw new Error('Unknown network: use mainnet, preprod or preview');
  const list = [];
  if (workerBase) list.push({ source: 'Worker proxy', base: `${workerBase.replace(/\/$/, '')}/${network}/api/v1` });
  list.push({ source: 'Koios', base: k });
  if (allowPublicRelay) list.push({ source: `Koios via ${new URL(PUBLIC_RELAY).host}`, base: PUBLIC_RELAY + k });
  return list;
}

/** Normalise one Koios tx_info row. */
export function normalizeTxInfo(row) {
  if (!row) return null;
  return {
    txHash: row.tx_hash,
    blockHeight: row.block_height ?? null,
    timestamp: row.tx_timestamp ?? null,
    metadata: row.metadata || null,
    inputs: (row.inputs || []).map((i) => ({ address: i?.payment_addr?.bech32 || null, cred: i?.payment_addr?.cred || null })),
  };
}

export async function fetchTx(network, txHash, opts = {}) {
  const { fetchImpl = globalThis.fetch.bind(globalThis), timeoutMs = 12000 } = opts;
  const errors = [];
  for (const s of sourcesFor(network, opts)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(s.base + txInfoPath(txHash), { headers: { accept: 'application/json' }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error('Unexpected response');
      return { source: s.source, tx: normalizeTxInfo(rows[0]) };
    } catch (e) {
      errors.push(`${s.source}: ${e.name === 'AbortError' ? 'timed out' : e.message || e}`);
    } finally {
      clearTimeout(timer);
    }
  }
  const err = new Error('Could not reach a Cardano indexer. ' + errors.join(' | '));
  err.unreachable = true;
  throw err;
}
