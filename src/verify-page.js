// Verifier page. Needs no wallet and no account. Works in browsers and in the
// Android app (where scanned links are checked in place).
import './style.css';
import { $, h, testnetBanner, networkBanner, footer } from './ui-common.js';
import { CONFIG } from './config.js';
import { decodeFragment, looksLikeVerifyLink } from './lib/link.js';
import { verifyCertificate } from './lib/verify.js';
import { fileSha256 } from './lib/certificate.js';
import { startScan, decodeImageFile } from './scan.js';

$('#banner').append(testnetBanner());
$('#footer').append(footer());

let issuers = [];
const issuersReady = fetch('./issuers.json').then((r) => r.json()).then((j) => (issuers = j.issuers || [])).catch(() => {});

const LABELS = {
  valid: ['✅', 'Valid certificate', 'ok'],
  not_found: ['❔', 'Not found on Cardano', 'warn'],
  mismatch: ['❌', 'Does not match', 'bad'],
  error: ['⚠️', "Couldn't check right now", 'warn'],
};

function fmtTime(ts) {
  if (!ts) return null;
  return new Date(ts * 1000).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

function issuerLine(r) {
  if (r.issuer === 'registry') return h('p', { class: 'ok' }, `Issued by ${r.registryEntry.name} (wallet listed in our issuer registry).`);
  if (r.issuer === 'printed') return h('p', {}, 'Stamped by the issuer wallet printed on this certificate. That wallet is not in our issuer registry yet, so confirm it with the issuer if it matters.');
  if (r.issuer === 'no_match') return h('p', { class: 'bad' }, 'Warning: this stamp was signed by a different wallet than the one printed on the certificate.');
  return h('p', {}, 'The issuer wallet is not in our registry. Ask the issuer which wallet they stamp from if you need to confirm who issued it.');
}

function renderResult(link, r) {
  const [icon, title, cls] = LABELS[r.status];
  const f = link.fields;
  const card = h('div', { class: `result ${cls}` },
    h('h2', {}, `${icon} ${title}`),
    r.status === 'valid' ? null : h('p', {}, r.reason),
    h('dl', {},
      h('dt', {}, 'Name'), h('dd', {}, f.recipient_name || '—'),
      h('dt', {}, 'Course'), h('dd', {}, f.course || '—'),
      h('dt', {}, 'Awarded'), h('dd', {}, f.date_awarded || '—'),
      f.grade ? [h('dt', {}, 'Grade'), h('dd', {}, f.grade)] : null,
      f.expires ? [h('dt', {}, 'Valid until'), h('dd', {}, f.expires)] : null,
      h('dt', {}, 'Issuer'), h('dd', {}, f.issuer || '—'),
      h('dt', {}, 'Certificate no.'), h('dd', {}, f.cert_no || '—'),
      r.status === 'valid' ? [h('dt', {}, 'Stamped'), h('dd', {}, fmtTime(r.timestamp) || 'just now (block time pending)'), h('dt', {}, 'Batch size'), h('dd', {}, String(r.batchSize))] : null),
    r.status === 'valid' ? issuerLine(r) : null,
    r.status === 'valid' && link.pdfHash ? pdfCheck(link.pdfHash) : null,
    h('p', { class: 'small' },
      `Network: ${link.network}${link.network === 'mainnet' ? '' : ' (test network: not real-world proof)'}. `,
      r.source ? `Checked via ${r.source}. ` : '',
      h('a', { href: r.explorerUrl, target: '_blank', rel: 'noopener' }, 'View the transaction on Cardanoscan'),
      ' to double-check independently.'),
    r.status === 'not_found' || r.status === 'error' ? h('button', { type: 'button', onclick: () => run(link) }, 'Try again') : null);
  $('#result').replaceChildren(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function pdfCheck(expected) {
  const out = h('p', { class: 'small' }, 'This certificate is tied to a specific PDF file. Choose the PDF to confirm it is the exact file that was stamped.');
  const input = h('input', { type: 'file', accept: 'application/pdf,.pdf' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const got = await fileSha256(new Uint8Array(await file.arrayBuffer()));
    out.replaceChildren(got === expected ? h('strong', { class: 'ok' }, '✅ The PDF matches the stamped file.') : h('strong', { class: 'bad' }, '❌ This PDF is not the stamped file. It may have been changed.'));
  });
  return h('div', { class: 'pdfcheck' }, out, h('label', { class: 'upload' }, 'Choose PDF ', input));
}

async function run(link) {
  $('#banner').replaceChildren(networkBanner(link.network));
  $('#result').replaceChildren(h('div', { class: 'result' }, h('p', {}, 'Checking Cardano…')));
  try {
    await issuersReady;
    const r = await verifyCertificate(link, { issuers, workerBase: CONFIG.workerBase, allowPublicRelay: CONFIG.allowPublicRelay });
    renderResult(link, r);
  } catch (e) {
    $('#result').replaceChildren(h('div', { class: 'result warn' }, h('h2', {}, "⚠️ Couldn't check right now"), h('p', {}, e.message || String(e))));
  }
}

function handleText(text) {
  if (!looksLikeVerifyLink(text)) {
    $('#result').replaceChildren(h('div', { class: 'result bad' }, h('h2', {}, '❌ Not a certificate link'), h('p', {}, 'That QR code or link is not a Cert Stamp verify link.')));
    return;
  }
  let link;
  try { link = decodeFragment(text); } catch (e) {
    $('#result').replaceChildren(h('div', { class: 'result bad' }, h('h2', {}, '❌ Broken link'), h('p', {}, e.message)));
    return;
  }
  run(link);
}

let stopScan = null;
$('#scanBtn').addEventListener('click', () => {
  $('#scanWrap').hidden = false;
  stopScan = startScan($('#video'), (text) => { $('#scanWrap').hidden = true; handleText(text); },
    (e) => { $('#scanWrap').hidden = true; $('#result').replaceChildren(h('div', { class: 'result warn' }, h('p', {}, e.message))); });
});
$('#stopScan').addEventListener('click', () => { if (stopScan) stopScan(); $('#scanWrap').hidden = true; });
$('#qrFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const text = await decodeImageFile(f).catch(() => null);
  if (text) handleText(text);
  else $('#result').replaceChildren(h('div', { class: 'result warn' }, h('p', {}, 'No QR code found in that image. Try a sharper, closer photo.')));
});
$('#pasteForm').addEventListener('submit', (e) => { e.preventDefault(); handleText($('#pasteInput').value); });

if (location.hash.length > 1) handleText(location.hash);
window.addEventListener('hashchange', () => location.hash.length > 1 && handleText(location.hash));
