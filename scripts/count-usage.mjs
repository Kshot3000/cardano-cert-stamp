#!/usr/bin/env node
// Count Cert Stamp usage straight from the chain. No analytics, no cookies:
// every stamp tx carries a CIP-190 label-309 record whose "x-kshot" extension
// says { app: "kshot-cert-stamp", app_ver }, so we can count stamps (txs) and
// certificates (sum of Merkle leaf_count) on any network.
//
// Usage:
//   node scripts/count-usage.mjs [--network preprod|preview|mainnet] [--after-block N] [--json]
// Sources:
//   default: Koios public API (no key).
//   KOIOS_TOKEN=...            optional Koios bearer token (free tier raises limits)
//   BLOCKFROST_PROJECT_ID=...  use Blockfrost instead of Koios (env var, never committed)
import { parseRecord, APP_ID, LABEL } from '../src/lib/record.js';
import { KOIOS } from '../src/lib/indexer.js';
import { decode } from '../src/lib/cbor.js';
import { fromHex } from '../src/lib/hash.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const network = opt('--network', 'preprod');
const afterBlock = Number(opt('--after-block', 0));
const asJson = args.includes('--json');
if (!KOIOS[network]) { console.error('Unknown network. Use preprod, preview or mainnet.'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, init = {}, tries = 4) {
  for (let t = 1; ; t++) {
    const res = await fetch(url, init);
    if (res.ok) return res.json();
    if (res.status === 404) return [];
    if (t >= tries || ![429, 500, 502, 503, 504].includes(res.status)) throw new Error(`${res.status} ${await res.text()}`.slice(0, 300));
    await sleep(1000 * t);
  }
}

function tally(stats, txHash, metadata, blockTime) {
  const rec = parseRecord(metadata);
  if (!rec || rec.ext?.app !== APP_ID) return;
  stats.stamps += 1;
  const certs = rec.merkle.reduce((n, m) => n + m.leafCount, 0);
  stats.certificates += certs;
  const v = rec.ext.app_ver || 'unknown';
  stats.byVersion[v] = (stats.byVersion[v] || 0) + 1;
  if (blockTime) {
    const month = new Date(blockTime * 1000).toISOString().slice(0, 7);
    stats.byMonth[month] ||= { stamps: 0, certificates: 0 };
    stats.byMonth[month].stamps += 1;
    stats.byMonth[month].certificates += certs;
  }
  stats.latest.push(txHash);
}

async function viaKoios(stats) {
  const base = KOIOS[network];
  const headers = { accept: 'application/json', 'content-type': 'application/json' };
  if (process.env.KOIOS_TOKEN) headers.authorization = `Bearer ${process.env.KOIOS_TOKEN}`;
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const url = `${base}/tx_by_metalabel?_label=${LABEL}${afterBlock ? `&_after_block_height=${afterBlock}` : ''}&order=block_height.asc&limit=${page}&offset=${offset}`;
    const txs = await getJson(url, { headers });
    if (!txs.length) break;
    stats.scanned += txs.length;
    const times = new Map(txs.map((t) => [t.tx_hash, t.tx_timestamp]));
    for (let i = 0; i < txs.length; i += 50) {
      const hashes = txs.slice(i, i + 50).map((t) => t.tx_hash);
      const rows = await getJson(`${base}/tx_metadata`, { method: 'POST', headers, body: JSON.stringify({ _tx_hashes: hashes }) });
      for (const r of rows) tally(stats, r.tx_hash, r.metadata, times.get(r.tx_hash));
    }
    if (txs.length < page) break;
  }
}

async function viaBlockfrost(stats) {
  const base = `https://cardano-${network}.blockfrost.io/api/v0`;
  const headers = { project_id: process.env.BLOCKFROST_PROJECT_ID };
  for (let p = 1; ; p++) {
    const rows = await getJson(`${base}/metadata/txs/labels/${LABEL}/cbor?count=100&page=${p}`, { headers });
    if (!rows.length) break;
    stats.scanned += rows.length;
    for (const r of rows) {
      let value;
      try { value = decode(fromHex(r.metadata || r.cbor_metadata?.replace(/^\\x/, '') || '')); } catch { continue; }
      tally(stats, r.tx_hash, { [LABEL]: value }, null);
    }
    if (rows.length < 100) break;
  }
}

const stats = { network, source: process.env.BLOCKFROST_PROJECT_ID ? 'Blockfrost' : 'Koios', scanned: 0, stamps: 0, certificates: 0, byVersion: {}, byMonth: {}, latest: [] };
try {
  await (process.env.BLOCKFROST_PROJECT_ID ? viaBlockfrost(stats) : viaKoios(stats));
} catch (e) {
  console.error('Lookup failed:', e.message);
  process.exit(1);
}
stats.latest = stats.latest.slice(-5);
if (asJson) console.log(JSON.stringify(stats, null, 2));
else {
  console.log(`Cert Stamp usage on ${network} (via ${stats.source})`);
  console.log(`  label-309 txs scanned: ${stats.scanned}`);
  console.log(`  stamps (txs) by ${APP_ID}: ${stats.stamps}`);
  console.log(`  certificates stamped: ${stats.certificates}`);
  for (const [m, v] of Object.entries(stats.byMonth)) console.log(`  ${m}: ${v.stamps} stamps, ${v.certificates} certificates`);
  if (stats.latest.length) console.log(`  latest txs: ${stats.latest.join(', ')}`);
}
