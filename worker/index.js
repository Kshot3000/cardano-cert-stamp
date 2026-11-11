// Optional read-only proxy for the verify page (Cloudflare Workers free tier).
// It forwards exactly one Koios call (tx_info for one tx hash) and adds CORS
// headers. Keys live only in Worker env vars / secrets, never in this repo:
//   KOIOS_TOKEN            optional Koios bearer token
//   BLOCKFROST_PREPROD / BLOCKFROST_PREVIEW / BLOCKFROST_MAINNET  optional failover project ids
//   ALLOWED_ORIGINS        comma-separated origins, e.g. "https://kshot3000.github.io,https://localhost"
// Route: GET /{mainnet|preprod|preview}/api/v1/tx_info?_tx_hashes={<64 hex>}&_inputs=true&_metadata=true
const KOIOS = { mainnet: 'https://api.koios.rest/api/v1', preprod: 'https://preprod.koios.rest/api/v1', preview: 'https://preview.koios.rest/api/v1' };

function cors(req, env) {
  const origin = req.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = !allowed.length || allowed.includes(origin);
  return { 'access-control-allow-origin': ok ? origin || '*' : 'null', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'accept, content-type', vary: 'origin' };
}
const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=30', ...headers } });

// Decode a CBOR array of byte strings (the label-309 chunk array) to "0x" hex strings.
function chunkArrayToHex(hex) {
  const b = hex.match(/../g).map((x) => parseInt(x, 16));
  let p = 0;
  const len = (ai) => (ai < 24 ? ai : ai === 24 ? b[p++] : ai === 25 ? (b[p++] << 8) | b[p++] : (() => { throw new Error('len'); })());
  const ib = b[p++];
  if (ib >> 5 !== 4) return null;
  const n = len(ib & 31), out = [];
  for (let i = 0; i < n; i++) {
    const h = b[p++];
    if (h >> 5 !== 2) return null;
    const l = len(h & 31);
    out.push('0x' + b.slice(p, p + l).map((x) => x.toString(16).padStart(2, '0')).join(''));
    p += l;
  }
  return out;
}

async function blockfrost(network, hash, env) {
  const id = env[`BLOCKFROST_${network.toUpperCase()}`];
  if (!id) return null;
  const base = `https://cardano-${network}.blockfrost.io/api/v0`;
  const get = async (path) => { const r = await fetch(base + path, { headers: { project_id: id } }); if (r.status === 404) return null; if (!r.ok) throw new Error('blockfrost ' + r.status); return r.json(); };
  const tx = await get(`/txs/${hash}`);
  if (!tx) return [];
  const [utxos, md] = await Promise.all([get(`/txs/${hash}/utxos`), get(`/txs/${hash}/metadata/cbor`)]);
  const metadata = {};
  for (const m of md || []) {
    if (m.label === '309') metadata['309'] = chunkArrayToHex(m.metadata || m.cbor_metadata?.replace(/^\\x/, '').slice(0) || '');
  }
  return [{ tx_hash: hash, block_height: tx.block_height, tx_timestamp: tx.block_time, metadata, inputs: (utxos?.inputs || []).map((i) => ({ payment_addr: { bech32: i.address, cred: null } })) }];
}

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'GET') return json({ error: 'GET only' }, 405, h);
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/(mainnet|preprod|preview)\/api\/v1\/tx_info$/);
    const hash = (url.searchParams.get('_tx_hashes') || '').replace(/[{}]/g, '').toLowerCase();
    if (!m || !/^[0-9a-f]{64}$/.test(hash)) return json({ error: 'Only tx_info for one tx hash is proxied' }, 400, h);
    const network = m[1];
    try {
      const headers = { accept: 'application/json' };
      if (env.KOIOS_TOKEN) headers.authorization = `Bearer ${env.KOIOS_TOKEN}`;
      const r = await fetch(`${KOIOS[network]}/tx_info?_tx_hashes=%7B${hash}%7D&_inputs=true&_metadata=true`, { headers });
      if (!r.ok) throw new Error('koios ' + r.status);
      return json(await r.json(), 200, h);
    } catch (e) {
      try {
        const rows = await blockfrost(network, hash, env);
        if (rows) return json(rows, 200, h);
      } catch {}
      return json({ error: 'Upstream indexer unavailable' }, 502, h);
    }
  },
};
