// Verify a certificate against the chain.
import { certificateDigest } from './certificate.js';
import { verifyInclusion } from './merkle.js';
import { parseRecord } from './record.js';
import { fetchTx, EXPLORER } from './indexer.js';
import { paymentCredential } from './address.js';

/**
 * status:
 *  valid     the tx carries a CIP-190 record whose Merkle root includes this certificate
 *  not_found no such tx on that test network (or not indexed yet)
 *  mismatch  the tx exists but this certificate isn't in it (edited, or not a stamp)
 *  error     couldn't reach an indexer
 * issuer: 'registry' (signing wallet is in issuers.json), 'printed' (matches the
 * issuer wallet printed on the certificate only), 'no_match', or 'unknown'.
 */
export async function verifyCertificate(link, opts = {}) {
  const { network, txHash, index, salt, fields, proof, pdfHash } = link;
  const base = { network, txHash, explorerUrl: (EXPLORER[network] || '') + txHash, fields };
  let d;
  try { d = await certificateDigest(fields, salt, pdfHash); }
  catch (e) { return { ...base, status: 'mismatch', reason: e.message }; }

  let lookup;
  try { lookup = await (opts.fetchTx || fetchTx)(network, txHash, opts); }
  catch (e) { return { ...base, status: 'error', reason: e.message }; }
  const { tx, source } = lookup;
  if (!tx) return { ...base, status: 'not_found', source, reason: `No transaction ${txHash.slice(0, 12)}… on ${network}. A brand-new stamp can take a minute or two to show up.` };

  const record = parseRecord(tx.metadata);
  if (!record) return { ...base, status: 'mismatch', source, reason: 'That transaction exists but carries no certificate stamp (CIP-190 label 309).' };
  let hit = null;
  for (const m of record.merkle) if (await verifyInclusion(d, index, m.leafCount, proof, m.root)) { hit = m; break; }
  if (!hit) return { ...base, status: 'mismatch', source, reason: 'This certificate does not match what was stamped. It may have been edited.' };

  const signers = [...new Set(tx.inputs.map((i) => i.address).filter(Boolean))];
  const signerCreds = new Set(tx.inputs.map((i) => i.cred || paymentCredential(i.address)).filter(Boolean));
  const registry = opts.issuers || [];
  const reg = registry.find((r) => r.network === network && signerCreds.has(paymentCredential(r.address)));
  let issuer = 'unknown';
  if (reg) issuer = 'registry';
  else if (fields.issuer_addr) issuer = signerCreds.has(paymentCredential(fields.issuer_addr)) ? 'printed' : 'no_match';
  return { ...base, status: 'valid', source, d, root: hit.root, batchSize: hit.leafCount, timestamp: tx.timestamp, blockHeight: tx.blockHeight, issuer, registryEntry: reg || null, signers };
}
