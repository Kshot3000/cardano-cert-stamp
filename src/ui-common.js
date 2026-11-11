import QRCode from 'qrcode';
import { CONFIG } from './config.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

export const MAINNET_WARNING = 'MAINNET uses real ADA. This software is in testing and has not been audited. The network fee comes from your own wallet; we never hold your keys or funds.';

/** Network banner. network = 'mainnet' | 'preprod' | 'preview' | null (unknown yet). */
export function networkBanner(network) {
  if (network === 'mainnet') return h('div', { class: 'banner danger', role: 'note' }, h('strong', {}, 'MAINNET · REAL ADA · UNAUDITED. '), MAINNET_WARNING.replace(/^MAINNET uses real ADA\. /, ''));
  if (network) return h('div', { class: 'banner', role: 'note' }, h('strong', {}, `TESTNET (${network}) · IN TESTING. `), 'Uses free test ADA. Test stamps are for trying the app, not real-world proof.');
  return h('div', { class: 'banner', role: 'note' }, h('strong', {}, 'IN TESTING · UNAUDITED. '), 'Works on Cardano Preprod (test) and Mainnet. Each certificate link says which network it was stamped on.');
}
export const testnetBanner = () => networkBanner(null);

export async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); if (btn) { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = t), 1500); } }
  catch { prompt('Copy this:', text); }
}

/** "Support the dev" tip box. Optional, mainnet ADA, unlocks nothing. */
export function tipBox() {
  if (!CONFIG.TIP_ENABLED || !CONFIG.TIP_ADDRESS) return null;
  const addr = CONFIG.TIP_ADDRESS;
  const qr = h('img', { alt: 'QR code of the tip address', class: 'tip-qr', width: 120, height: 120 });
  QRCode.toDataURL(`web+cardano:${addr}`, { margin: 1, width: 240 }).then((u) => (qr.src = u));
  const details = h('details', { class: 'tip' },
    h('summary', {}, 'Support the dev'),
    h('p', {}, 'Optional tip in real (mainnet) ADA to the developer. It unlocks nothing: no badges, no features. Stamping and verifying stay the same either way.'),
    qr,
    h('code', { class: 'addr' }, addr),
    h('div', { class: 'row' },
      h('button', { type: 'button', onclick: (e) => copyText(addr, e.target) }, 'Copy address'),
      h('a', { class: 'button secondary', href: `web+cardano:${addr}` }, 'Open in wallet')));
  return details;
}

export function footer() {
  return h('footer', {},
    tipBox(),
    h('p', { class: 'small' }, 'Free to use. Open source (MIT). No trackers or analytics cookies. Only salted fingerprints go on-chain, never names. ',
      h('a', { href: 'https://github.com/Kshot3000/cardano-cert-stamp' }, 'Source code')));
}
