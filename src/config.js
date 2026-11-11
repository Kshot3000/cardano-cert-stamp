// App configuration. No secrets belong here: this file ships to every browser.
export const CONFIG = {
  // Default network for stamping. Stays 'preprod' until real-wallet tests pass.
  // The issuer can switch to 'mainnet' in the app after a real-ADA warning.
  network: 'preprod',
  networks: ['preprod', 'preview', 'mainnet'],

  // Optional read proxy (see worker/README.md). Leave '' to use Koios directly.
  // Example: 'https://cert-stamp-proxy.<your-subdomain>.workers.dev'
  workerBase: '',

  // Last-resort public CORS relay for Koios reads in browsers (see src/lib/indexer.js).
  allowPublicRelay: true,

  // Where printed QR codes point. Used when the app runs somewhere without a
  // public URL (the Android app, localhost). On a public https host the
  // current site's verify.html is used instead.
  publicVerifyUrl: 'https://kshot3000.github.io/cardano-cert-stamp/verify.html',

  // "Support the dev" tip button. Optional mainnet ADA tip to the developer.
  // It unlocks nothing: no badges, no features, no priority.
  TIP_ENABLED: true,
  TIP_ADDRESS: 'addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v',
};

export function verifyPageUrl() {
  const { protocol, hostname, href } = globalThis.location || {};
  const local = !hostname || hostname === 'localhost' || hostname === '127.0.0.1' || protocol === 'capacitor:' || protocol === 'file:';
  if (!local && protocol === 'https:') return new URL('verify.html', href).href;
  return CONFIG.publicVerifyUrl;
}
