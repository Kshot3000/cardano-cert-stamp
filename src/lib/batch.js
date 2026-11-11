// Turn certificates into one stamp: salted digests -> RFC 9162 Merkle root ->
// CIP-190 metadata, plus each certificate's audit path for its QR link.
import { certificateDigest, newSalt, validateFields } from './certificate.js';
import { buildTree, getProof } from './merkle.js';
import { buildStampMetadata } from './record.js';

export const MAX_BATCH = 10000;

/** items: [{ fields, pdfHash? , salt? }] */
export async function prepareBatch(items, { title } = {}) {
  if (!items.length) throw new Error('Nothing to stamp');
  if (items.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} certificates per stamp`);
  const problems = [];
  items.forEach((it, i) => { const e = validateFields(it.fields); if (e.length) problems.push(`Row ${i + 1}: ${e.join(', ')}`); });
  if (problems.length) throw new Error(problems.slice(0, 5).join('\n') + (problems.length > 5 ? `\n…and ${problems.length - 5} more` : ''));
  const entries = [];
  for (const it of items) {
    const salt = it.salt || newSalt();
    entries.push({ fields: it.fields, pdfHash: it.pdfHash || null, salt, d: await certificateDigest(it.fields, salt, it.pdfHash) });
  }
  const tree = await buildTree(entries.map((e) => e.d));
  entries.forEach((e, i) => { e.index = i; e.proof = getProof(tree, i); });
  return { root: tree.root, count: tree.count, metadata: buildStampMetadata(tree.root, tree.count, title), entries };
}

/** CSV with a header row: cert_no, recipient_name, course, date_awarded[, grade, expires]. Quoted fields allowed. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const clean = rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some(Boolean));
  if (clean.length < 2) return [];
  const alias = { name: 'recipient_name', recipient: 'recipient_name', student: 'recipient_name', date: 'date_awarded', certificate_no: 'cert_no', number: 'cert_no' };
  const head = clean[0].map((h) => { const k = h.toLowerCase().replace(/[\s-]+/g, '_'); return alias[k] || k; });
  const allowed = ['cert_no', 'recipient_name', 'course', 'date_awarded', 'grade', 'expires'];
  return clean.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => { if (allowed.includes(h) && r[i]) o[h] = r[i]; });
    return o;
  });
}

/** Issuer's private backup CSV (contains names and salts: keep it off-chain and private). */
export function backupCsv(batch, txHash, network, verifyUrlFor) {
  const esc = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  const cols = ['leaf_index', 'cert_no', 'recipient_name', 'course', 'date_awarded', 'grade', 'expires', 'salt', 'pdf_sha256', 'digest', 'verify_url'];
  const lines = [cols.join(',')];
  for (const e of batch.entries) {
    lines.push([e.index, e.fields.cert_no, e.fields.recipient_name, e.fields.course, e.fields.date_awarded, e.fields.grade, e.fields.expires, e.salt, e.pdfHash, e.d, verifyUrlFor(e)].map(esc).join(','));
  }
  return lines.join('\n') + '\n';
}

/** Public batch.json: root, tx and leaf digests only (salted, so safe to publish). */
export function publicBatchJson(batch, txHash, network) {
  return JSON.stringify({ format: 'kshot-cert-batch-v1', network, tx_hash: txHash, cip190: { label: 309, alg: 'rfc9162-sha256', root: batch.root, leaf_count: batch.count }, leaves: batch.entries.map((e) => e.d) }, null, 2);
}
