// Build, sign and submit the stamp transaction with the issuer's own CIP-30
// wallet (Lace, Eternl, Typhon, ...). We never see or hold keys. No indexer or
// API key is needed: UTxOs come from the wallet, fees use Mesh's built-in
// protocol parameters, and the wallet submits the signed tx itself.
import './polyfills.js';
import { BrowserWallet, MeshTxBuilder } from '@meshsdk/core';
import { networkId, addressMatchesNetwork } from './address.js';

export function installedWallets() {
  try { return BrowserWallet.getInstalledWallets(); } catch { return []; }
}

export async function connectWallet(name, network) {
  const wallet = await BrowserWallet.enable(name);
  const id = await wallet.getNetworkId();
  if (id !== networkId(network)) {
    throw new Error(network === 'mainnet'
      ? 'This wallet is on a test network. Switch it to Mainnet, or pick Preprod above.'
      : `This wallet is on Mainnet. Switch it to ${network === 'preview' ? 'Preview' : 'Preprod'} in the wallet settings, or pick Mainnet above.`);
  }
  const address = await wallet.getChangeAddress();
  if (!addressMatchesNetwork(address, network)) throw new Error(`The wallet returned an address that is not a ${network} address.`);
  return { wallet, address };
}

/**
 * Unsigned stamp tx: a small payment back to the issuer's own address (so the
 * builder always selects an input) plus the metadata entries.
 * metadata: { 309: Uint8Array[], 674?: { msg: [title] } }
 */
export async function buildStampTx({ utxos, changeAddress, metadata, selfPaymentLovelace = '1500000' }) {
  if (!utxos || !utxos.length) throw new Error('This wallet has no ADA to pay the network fee. On a test network, get free test ADA from the Cardano testnet faucet.');
  let txb = new MeshTxBuilder({}).txOut(changeAddress, [{ unit: 'lovelace', quantity: selfPaymentLovelace }]);
  for (const [label, value] of Object.entries(metadata)) txb = txb.metadataValue(Number(label), value);
  return txb.changeAddress(changeAddress).selectUtxosFrom(utxos).complete();
}

export async function stampWithWallet(wallet, metadata) {
  const [utxos, changeAddress] = await Promise.all([wallet.getUtxos(), wallet.getChangeAddress()]);
  const unsigned = await buildStampTx({ utxos, changeAddress, metadata });
  const signed = await wallet.signTx(unsigned);
  return wallet.submitTx(signed);
}
