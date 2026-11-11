// Minimal bech32 decoder for Shelley addresses (no checksum-less input accepted).
// Used to compare the payment credential of the wallet that signed a stamp
// with the issuer wallet printed on the certificate.
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp) {
  const out = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

export function bech32Decode(str) {
  const s = String(str || '').toLowerCase();
  const pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length) throw new Error('Not bech32');
  const hrp = s.slice(0, pos);
  const data = [];
  for (const ch of s.slice(pos + 1)) {
    const d = CHARSET.indexOf(ch);
    if (d === -1) throw new Error('Not bech32');
    data.push(d);
  }
  if (polymod([...hrpExpand(hrp), ...data]) !== 1) throw new Error('Bad bech32 checksum');
  const words = data.slice(0, -6);
  let acc = 0, bits = 0;
  const bytes = [];
  for (const w of words) {
    acc = (acc << 5) | w; bits += 5;
    while (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
  }
  return { hrp, bytes: Uint8Array.from(bytes) };
}

/** Hex payment credential (28 bytes) of a Shelley base/enterprise/pointer address. */
export function paymentCredential(addr) {
  try {
    const { hrp, bytes } = bech32Decode(addr);
    if (!hrp.startsWith('addr')) return null;
    const type = bytes[0] >> 4;
    if (type > 7 || bytes.length < 29) return null;
    return Array.from(bytes.subarray(1, 29), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export function isTestnetAddress(addr) {
  return String(addr || '').toLowerCase().startsWith('addr_test1');
}

/** CIP-30 network id for a network name: mainnet = 1, testnets = 0. */
export const networkId = (network) => (network === 'mainnet' ? 1 : 0);

/** True if addr is a valid Shelley payment address for that network. */
export function addressMatchesNetwork(addr, network) {
  if (!paymentCredential(addr)) return false;
  const { hrp, bytes } = bech32Decode(addr);
  const id = bytes[0] & 0x0f;
  return network === 'mainnet' ? hrp === 'addr' && id === 1 : hrp === 'addr_test' && id === 0;
}
