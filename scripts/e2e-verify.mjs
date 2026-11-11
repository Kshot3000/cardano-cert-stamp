// Headless-Chrome check of the built verify page (npm run build && npx vite preview --port 4173).
//  1. a real Preprod tx with no Worker configured: the browser can't reach Koios (CORS) and
//     there is no public relay, so it must say "Couldn't check" yet still link Cardanoscan
//  2. a simulated stamp (Koios response intercepted) -> "Stamp found, issuer not verified";
//     the same stamp with the signer in issuers.json -> "Valid certificate · Issued by ...";
//     an edited link -> "Does not match"
import puppeteer from 'puppeteer-core';
import { prepareBatch } from '../src/lib/batch.js';
import { buildVerifyUrl } from '../src/lib/link.js';
import { toHex } from '../src/lib/hash.js';
import QRCode from 'qrcode';

const BASE = process.env.BASE || 'http://localhost:4173';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const ADDR = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae';
const FAKE_TX = 'f'.repeat(63) + '1';
const DOWN_TX = 'f'.repeat(63) + '2';

const items = Array.from({ length: 30 }, (_, i) => ({ fields: { cert_no: `WLD-${i}`, recipient_name: `Student ${i}`, course: 'Welding Level 1', date_awarded: '2026-11-10', issuer: 'Demo Trade School', issuer_addr: ADDR } }));
const batch = await prepareBatch(items, { title: 'Demo batch' });
const e = batch.entries[17];
const link = { network: 'preprod', txHash: FAKE_TX, index: e.index, salt: e.salt, fields: e.fields, proof: e.proof };
const validUrl = buildVerifyUrl(`${BASE}/verify.html`, link);
const editedUrl = buildVerifyUrl(`${BASE}/verify.html`, { ...link, fields: { ...e.fields, course: 'Welding Level 3' } });
const realNonStamp = buildVerifyUrl(`${BASE}/verify.html`, { ...link, txHash: '8e70e0ec964be7eb970d429ab65995858b1c8ee9befc06e47339dc920df9cb72' });

const b = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--headless=new'] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, isMobile: true });
const errors = [];
p.on('pageerror', (x) => errors.push(x.message));
p.on('console', (m) => process.env.DEBUG && console.log('console:', m.type(), m.text()));
p.on('requestfailed', (r) => process.env.DEBUG && console.log('failed:', r.url().slice(0, 90), r.failure()?.errorText));
await p.setRequestInterception(true);
let registryOn = false;
p.on('request', (r) => {
  if (registryOn && r.url().endsWith('/issuers.json')) return void r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ issuers: [{ name: 'Demo Trade School (registry)', network: 'preprod', address: ADDR }] }) });
  if (r.url().includes('/tx_info') && r.url().includes(DOWN_TX)) return void r.abort('failed');
  if (process.env.DEBUG && !r.url().startsWith(BASE)) console.log('req:', r.method(), r.url().slice(0, 100));
  if (r.url().includes('/tx_info') && r.url().includes(FAKE_TX)) {
    return void r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([{ tx_hash: FAKE_TX, block_height: 4000000, tx_timestamp: 1762819200, metadata: { 309: batch.metadata[309].map((c) => '0x' + toHex(c)), 674: batch.metadata[674] }, inputs: [{ payment_addr: { bech32: ADDR, cred: '9493315cd92eb5d8c4304e67b7e16ae36d61d34502694657811a2c8e' } }] }]) }).catch((err) => console.log('respond error', err.message));
  }
  r.continue();
});
let explorerMissing = false;
const check = async (url, label) => {
  await p.goto('about:blank');
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  try { await p.waitForFunction(() => document.querySelector('#result h2'), { timeout: 20000 }); } catch (err) { if (process.env.DEBUG) console.log('probe:', await p.evaluate(async (u) => { try { const r = await Promise.race([fetch(u, { headers: { accept: 'application/json' } }), new Promise((_, j) => setTimeout(() => j(new Error('probe timeout')), 5000))]); return r.status + ' ' + (await r.text()).slice(0, 60); } catch (e) { return 'ERR ' + e.message; } }, `https://preprod.koios.rest/api/v1/tx_info?_tx_hashes=%7B${FAKE_TX}%7D&_inputs=true&_metadata=true`));
    console.log('TIMEOUT, result =', await p.$eval('#result', (el) => el.innerHTML.slice(0, 300)), 'hash len', url.length); throw err; }
  const out = await p.$eval('#result', (el) => el.innerText.replace(/\s+/g, ' ').slice(0, 260));
  const href = await p.$eval('#result', (el) => el.querySelector('a[href*="cardanoscan.io/transaction/"]')?.href || '');
  if (!href.startsWith('https://preprod.cardanoscan.io/transaction/')) { console.log(`${label}: MISSING explorer link`); explorerMissing = true; }
  console.log(`${label}: ${out}`);
  return out;
};
const r1 = await check(realNonStamp, 'real preprod tx, no Worker');
const r2 = await check(validUrl, 'simulated stamp');
await p.screenshot({ path: process.env.SHOT || '/tmp/verify-valid.png', fullPage: true });
const r3 = await check(editedUrl, 'edited certificate');
registryOn = true;
const r6 = await check(validUrl, 'simulated stamp, issuer in registry');
registryOn = false;
const r5 = await check(buildVerifyUrl(`${BASE}/verify.html`, { ...link, txHash: DOWN_TX }), 'indexers unreachable');
// 3. scan path: QR image of the valid link uploaded as a photo -> jsQR -> Valid
const qrPath = '/tmp/e2e-qr.png';
await QRCode.toFile(qrPath, validUrl, { errorCorrectionLevel: 'M', width: 500 });
await p.goto('about:blank');
await p.goto(`${BASE}/verify.html`, { waitUntil: 'domcontentloaded' });
await (await p.$('#qrFile')).uploadFile(qrPath);
await p.waitForFunction(() => document.querySelector('#result h2'), { timeout: 30000 });
const r4 = await p.$eval('#result', (el) => el.innerText.replace(/\s+/g, ' ').slice(0, 120));
console.log(`QR photo upload: ${r4}`);
await b.close();
const ok = !explorerMissing && r1.includes("Couldn't check right now") && r1.includes('no read proxy') && r2.includes('Stamp found, issuer not verified') && !r2.includes('Valid certificate') && r2.includes('self-declared, not verified') && r2.includes('Student 17') && r6.includes('Valid certificate · Issued by Demo Trade School (registry)') && r3.includes('Does not match') && r4.includes('Stamp found, issuer not verified') && r5.includes("Couldn't check right now");
console.log(ok && !errors.length ? 'E2E VERIFY: PASS' : `E2E VERIFY: FAIL ${errors.join('; ')}`);
process.exit(ok && !errors.length ? 0 : 1);
