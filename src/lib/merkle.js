// RFC 9162 §2.1 Merkle tree with SHA-256 ("rfc9162-sha256" in CIP-190).
//   leaf     = SHA-256(0x00 || d)
//   internal = SHA-256(0x01 || left || right)
//   split k  = largest power of two strictly less than n
// Proofs are the RFC 9162 audit path (sibling hashes, leaf level first) and
// verify with the §2.1.3.2 algorithm, which needs the leaf index and tree size.
// Checked against the CIP-190 conformance vectors in test/vectors/.
import { sha256, toHex, fromHex, concat, isHash } from './hash.js';

const LEAF = new Uint8Array([0]);
const NODE = new Uint8Array([1]);

export async function leafHash(dHex) {
  if (!isHash(dHex)) throw new Error('leaf digest must be 64 lowercase hex chars');
  return toHex(await sha256(concat(LEAF, fromHex(dHex))));
}

export async function nodeHash(leftHex, rightHex) {
  return toHex(await sha256(concat(NODE, fromHex(leftHex), fromHex(rightHex))));
}

function split(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** Build the tree. Returns { root, count, nodes } where nodes memoises every subtree hash. */
export async function buildTree(digests) {
  if (!Array.isArray(digests) || digests.length === 0) throw new Error('Need at least one leaf');
  const leaves = await Promise.all(digests.map(leafHash));
  const nodes = new Map();
  async function mth(lo, n) {
    const key = lo + ':' + n;
    if (nodes.has(key)) return nodes.get(key);
    let h;
    if (n === 1) h = leaves[lo];
    else { const k = split(n); h = await nodeHash(await mth(lo, k), await mth(lo + k, n - k)); }
    nodes.set(key, h);
    return h;
  }
  const root = await mth(0, leaves.length);
  return { root, count: leaves.length, nodes };
}

/** RFC 9162 PATH(m, D[n]): sibling hashes from the leaf level up. */
export function getProof(tree, index) {
  if (!Number.isInteger(index) || index < 0 || index >= tree.count) throw new Error('index out of range');
  const path = [];
  (function walk(m, lo, n) {
    if (n <= 1) return;
    const k = split(n);
    if (m < k) { walk(m, lo, k); path.push(tree.nodes.get(lo + k + ':' + (n - k))); }
    else { walk(m - k, lo + k, n - k); path.push(tree.nodes.get(lo + ':' + k)); }
  })(index, 0, tree.count);
  return path;
}

/** RFC 9162 §2.1.3.2 inclusion verification. */
export async function verifyInclusion(dHex, index, treeSize, proof, rootHex) {
  if (!Number.isInteger(index) || !Number.isInteger(treeSize) || index < 0 || index >= treeSize) return false;
  let fn = index, sn = treeSize - 1;
  let r = await leafHash(dHex);
  for (const p of proof) {
    if (!isHash(p) || sn === 0) return false;
    if ((fn & 1) === 1 || fn === sn) {
      r = await nodeHash(p, r);
      if ((fn & 1) === 0) while ((fn & 1) === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
    } else {
      r = await nodeHash(r, p);
    }
    fn >>= 1; sn >>= 1;
  }
  return sn === 0 && r === rootHex;
}
