import './style.css';
import { $, h, networkBanner, footer, copyText } from './ui-common.js';
import { CONFIG, verifyPageUrl } from './config.js';
import { prepareBatch, parseCsv, backupCsv, publicBatchJson } from './lib/batch.js';
import { fileSha256 } from './lib/certificate.js';
import { buildVerifyUrl } from './lib/link.js';
import { EXPLORER } from './lib/indexer.js';
import { renderPdf, renderPng, download, safeName, qrDataUrl } from './render.js';

let network = CONFIG.network;
const showBanner = () => $('#banner').replaceChildren(networkBanner(network));
showBanner();
document.querySelector(`input[name=network][value=${network}]`).checked = true;
for (const r of document.querySelectorAll('input[name=network]')) {
  r.addEventListener('change', () => {
    network = r.value;
    $('#mainnetAck').hidden = network !== 'mainnet';
    $('#ackMainnet').checked = false;
    wallet = null; walletAddr = '';
    $('#walletStatus').textContent = 'Network changed. Connect your wallet again.';
    showBanner(); updateButton();
  });
}
$('#ackMainnet').addEventListener('change', () => updateButton());
$('#footer').append(footer());

let wallet = null, walletAddr = '', mode = 'one', csvRows = [];
let stampLib = null;
const loadStamp = async () => (stampLib ||= await import('./lib/stamp.js'));

// ---- wallet
async function listWallets() {
  const box = $('#wallets');
  const lib = await loadStamp();
  const ws = lib.installedWallets();
  if (!ws.length) {
    box.replaceChildren(h('p', { class: 'small' }, 'No Cardano wallet found in this browser. Install Lace or Eternl on desktop Chrome/Brave/Firefox, switch it to Preprod, then reload. (Stamping needs a desktop browser wallet; checking certificates works anywhere, including the Android app.)'));
    return;
  }
  box.replaceChildren(...ws.map((w) => h('button', { type: 'button', class: 'secondary', onclick: () => connect(w.id || w.name) }, h('img', { src: w.icon, alt: '', width: 20, height: 20 }), ' ', w.name)));
}
async function connect(name) {
  $('#walletStatus').textContent = 'Asking your wallet…';
  try {
    const lib = await loadStamp();
    ({ wallet, address: walletAddr } = await lib.connectWallet(name, network));
    $('#walletStatus').replaceChildren('Connected: ', h('code', { class: 'addr' }, walletAddr));
    updateButton();
  } catch (e) {
    wallet = null;
    $('#walletStatus').textContent = e.message || String(e);
    updateButton();
  }
}
listWallets();

// ---- tabs
for (const b of document.querySelectorAll('[data-tab]')) {
  b.addEventListener('click', () => {
    mode = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== mode));
    updateButton();
  });
}

// ---- csv
$('#csvTemplate').addEventListener('click', (e) => {
  e.preventDefault();
  download(new Blob(['cert_no,recipient_name,course,date_awarded,grade,expires\nWLD-0001,Sample Student,Welding Level 1,2026-11-10,Pass,\n'], { type: 'text/csv' }), 'certificates-template.csv');
});
$('#csvFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  csvRows = f ? parseCsv(await f.text()) : [];
  const prev = $('#csvPreview');
  if (!csvRows.length) { prev.replaceChildren(h('p', { class: 'bad' }, 'No rows found. Check the header row.')); updateButton(); return; }
  prev.replaceChildren(h('p', {}, `${csvRows.length} certificates ready.`),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['cert_no', 'recipient_name', 'course', 'date_awarded'].map((c) => h('th', {}, c)))),
      h('tbody', {}, csvRows.slice(0, 8).map((r) => h('tr', {}, ['cert_no', 'recipient_name', 'course', 'date_awarded'].map((c) => h('td', {}, r[c] || '')))))),
    csvRows.length > 8 ? h('p', { class: 'small' }, `…and ${csvRows.length - 8} more`) : null));
  updateButton();
});

function updateButton() {
  const b = $('#stampBtn');
  const needsAck = network === 'mainnet' && !$('#ackMainnet').checked;
  b.disabled = !wallet || needsAck;
  b.textContent = !wallet ? 'Connect a wallet first' : needsAck ? 'Tick the Mainnet warning first' : mode === 'csv' ? `Stamp ${csvRows.length || 0} certificates in one transaction` : 'Stamp this certificate';
}

// ---- stamp
async function collectItems() {
  const issuer = $('#issuer').value.trim();
  if (!issuer) throw new Error('Enter the issuer name first.');
  const base = { issuer, ...($('#printAddr').checked && walletAddr ? { issuer_addr: walletAddr } : {}) };
  if (mode === 'csv') {
    if (!csvRows.length) throw new Error('Choose a CSV file first.');
    return csvRows.map((r) => ({ fields: { ...r, ...base } }));
  }
  const fd = new FormData($('#oneForm'));
  const fields = { ...base };
  for (const k of ['cert_no', 'recipient_name', 'course', 'date_awarded', 'grade', 'expires']) if (fd.get(k)) fields[k] = String(fd.get(k));
  const pdf = fd.get('pdf');
  const pdfHash = pdf && pdf.size ? await fileSha256(new Uint8Array(await pdf.arrayBuffer())) : null;
  return [{ fields, pdfHash }];
}

$('#stampBtn').addEventListener('click', async () => {
  const status = $('#stampStatus');
  const btn = $('#stampBtn');
  btn.disabled = true;
  try {
    status.textContent = 'Fingerprinting certificates in your browser…';
    const batch = await prepareBatch(await collectItems(), { title: $('#title').value });
    status.textContent = `Merkle root ready for ${batch.count} certificate(s). Please approve the transaction in your wallet…`;
    if (network === 'mainnet' && !confirm(`Stamp ${batch.count} certificate(s) on Cardano MAINNET with real ADA? This software is unaudited.`)) throw new Error('Cancelled.');
    const lib = await loadStamp();
    const txHash = await lib.stampWithWallet(wallet, batch.metadata);
    status.replaceChildren('✅ Submitted. ', h('a', { href: EXPLORER[network] + txHash, target: '_blank', rel: 'noopener' }, 'View transaction'), ' (it can take a minute to confirm).');
    showResults(batch, txHash);
  } catch (e) {
    status.textContent = '❌ ' + (e?.info || e?.message || String(e));
  } finally {
    updateButton();
  }
});

function showResults(batch, txHash) {
  const vp = verifyPageUrl();
  const urlFor = (e) => buildVerifyUrl(vp, { network, txHash, index: e.index, salt: e.salt, fields: e.fields, proof: e.proof, pdfHash: e.pdfHash });
  const sec = $('#results');
  sec.hidden = false;
  const args = (e) => ({ fields: e.fields, verifyUrl: urlFor(e), txHash, network });
  const zipAll = async (btn) => {
    btn.disabled = true; const t = btn.textContent;
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const e of batch.entries) { btn.textContent = `Making PDFs ${e.index + 1}/${batch.count}…`; zip.file(`${safeName(e.fields.cert_no)}.pdf`, await renderPdf(args(e))); }
    zip.file('PRIVATE-backup-with-salts.csv', backupCsv(batch, txHash, network, urlFor));
    zip.file('batch.json', publicBatchJson(batch, txHash, network));
    download(await zip.generateAsync({ type: 'blob' }), `certificates-${txHash.slice(0, 10)}.zip`);
    btn.textContent = t; btn.disabled = false;
  };
  sec.replaceChildren(
    h('h2', {}, `5. Your ${batch.count} stamped certificate(s)`),
    h('p', { class: 'warn' }, h('strong', {}, 'Save the backup CSV now. '), 'It holds each certificate\'s secret salt. Without it you cannot reissue QR codes, and nobody else has a copy. Keep it private: it contains names.'),
    h('div', { class: 'row wrap' },
      h('button', { type: 'button', onclick: () => download(new Blob([backupCsv(batch, txHash, network, urlFor)], { type: 'text/csv' }), `PRIVATE-backup-${txHash.slice(0, 10)}.csv`) }, 'Download backup CSV (private)'),
      h('button', { type: 'button', class: 'secondary', onclick: () => download(new Blob([publicBatchJson(batch, txHash, network)], { type: 'application/json' }), `batch-${txHash.slice(0, 10)}.json`) }, 'batch.json (public, no names)'),
      batch.count > 1 ? h('button', { type: 'button', onclick: (ev) => zipAll(ev.target) }, 'Download all as ZIP of PDFs') : null),
    h('ul', { class: 'certs' }, batch.entries.slice(0, 200).map((e) => {
      const img = h('img', { alt: 'Verify QR', width: 96, height: 96 });
      qrDataUrl(urlFor(e), 192).then((u) => (img.src = u));
      return h('li', {}, img,
        h('div', {}, h('strong', {}, e.fields.recipient_name), h('br'), `${e.fields.course} · ${e.fields.cert_no}`, h('br'),
          h('div', { class: 'row wrap' },
            h('button', { type: 'button', onclick: async () => download(await renderPdf(args(e)), `${safeName(e.fields.cert_no)}.pdf`) }, 'PDF'),
            h('button', { type: 'button', class: 'secondary', onclick: async () => download(await renderPng(args(e)), `${safeName(e.fields.cert_no)}.png`) }, 'PNG'),
            h('button', { type: 'button', class: 'secondary', onclick: (ev) => copyText(urlFor(e), ev.target) }, 'Copy link'),
            h('a', { class: 'button secondary', href: urlFor(e), target: '_blank', rel: 'noopener' }, 'Open check page'))));
    })),
    batch.count > 200 ? h('p', { class: 'small' }, `Showing 200 of ${batch.count}. The ZIP and backup CSV include all of them.`) : null);
  sec.scrollIntoView({ behavior: 'smooth' });
}
