# Cert Stamp: certificates you can check on Cardano

> **Status: in testing, unaudited.** It defaults to the Cardano **Preprod test
> network**. Mainnet can be picked in the app behind a "real ADA, unaudited
> software" warning, but it has **not** yet been tested with a real wallet on
> any network. Don't rely on it for real certificates until that's done.

Cert Stamp lets trainers, trade schools and contractors stamp the certificates
they issue on the Cardano blockchain. Anyone holding a certificate can scan its
QR code and see right away that it's real and unchanged. The check doesn't
depend on our servers or the issuer's website: the record lives on Cardano and
the check page is a static file anyone can host.

**Free to use.** There are no plans, paywalls or accounts. The issuer's own
wallet pays the Cardano network fee (about 0.17–0.2 ADA per batch, whether the
batch holds 1 certificate or 1,000). An optional "Support the dev" tip button
in the footer unlocks nothing.

## How it works

1. **Fingerprint.** In the issuer's browser, each certificate (name, course,
   date, issuer, certificate number) is mixed with a secret random 32-byte salt
   and hashed with SHA-256.
2. **One stamp per batch.** All fingerprints in a batch go into one RFC 9162
   Merkle tree. Only its 32-byte root goes on-chain, in a single transaction
   signed by the school's own CIP-30 wallet (Lace, Eternl, Typhon…). We never
   see keys or hold funds.
3. **QR code.** Each certificate gets a PNG/PDF with a QR code. The QR link
   holds the certificate details, its salt and its Merkle proof, all after the
   `#` so they never reach a web server.
4. **Check.** The verify page re-hashes the details, walks the proof up to a
   root, reads the transaction from a public Cardano indexer, and shows
   **valid**, **does not match** (edited, or not a stamp) or **not found**, with
   a link to the transaction on Cardanoscan.

On-chain format: a [CIP-190](https://cips.cardano.org/cip/CIP-0190)
proof-of-existence record under metadata label **309**, plus a CIP-20 memo
under label 674. Details in [docs/METADATA.md](docs/METADATA.md).

### Privacy

No personal data goes on-chain: no names, grades, emails or certificate
numbers. Only a salted Merkle root, a count, the app id and an optional public
batch title. Because every certificate has its own random salt, nobody can
guess names from the chain. CSV columns the app doesn't know (like email) are
dropped before hashing.

**Issuers must keep the private backup CSV** the app offers after stamping. It
holds each certificate's salt. Without it, lost QR codes can't be reissued.

## What's in the MVP

* **Issuer page** (`issue.html`): pick the network, connect a CIP-30 wallet
  (network ID and `addr` vs `addr_test` checked), fill in one certificate or
  upload a class CSV, optionally bind your own PDF, stamp in one transaction,
  then download PDFs/PNGs with QR codes, a ZIP of all PDFs, the private backup
  CSV, and a public `batch.json` (root and salted leaf hashes, no names).
* **Verify page** (`verify.html`): camera QR scan (native `BarcodeDetector`,
  with [jsQR](https://github.com/cozmo/jsQR) as fallback), QR photo upload, or
  paste a link. It needs no wallet or account and reads the network from the
  link. If the certificate is bound to a PDF, it can check the file too.
* **Issuer check:** see [Who issued it?](#who-issued-it-the-issuer-registry)
  below. The page only says "Issued by [school]" when the signing wallet is in
  our curated `public/issuers.json` for that network. Otherwise it leads with
  "Stamp found, issuer not verified".
* **Android:** the same static build wrapped with Capacitor (`android/`). The
  verifier and QR scanning work in the app. Stamping needs a desktop browser
  wallet.

Not in the MVP: revocation, NFTs, student wallets, server-side signing, email
delivery, analytics.

## Who issued it? The issuer registry

**"Valid" means the certificate matches a stamp on Cardano and hasn't been
edited. On its own, it does not mean we vouch for the school.** Anyone can type
any school name into the issuer field and stamp it, and anyone can print their
own wallet address on a certificate. So the verify page shows:

* **✅ Valid certificate · Issued by [school]** only when the wallet that signed
  the stamp is listed for that school, on that network, in
  [`public/issuers.json`](public/issuers.json). The name shown comes from the
  registry, not from the certificate.
* **☑️ Stamp found, issuer not verified** in every other case. The name typed
  on the certificate is shown as "(self-declared, not verified)". If the
  signer differs from the wallet printed on the certificate, the page warns
  about that too.

Only spending inputs count as the signer. Reference and collateral inputs are
ignored, so nobody can borrow a school's UTxO to fake "issued by". Entries can
be `mainnet`, `preprod` or `preview`. An entry whose address doesn't match its
network is ignored.

### How a school gets added

We add schools ourselves, by hand. There is no on-chain or domain check yet.

1. The school stamps a small test batch from the wallet it will use for real
   certificates, on the network it wants listed.
2. We confirm out of band that the school controls that wallet. That means
   contacting the school through a phone number or website we find
   independently (not one the requester gives us) and having the school tell
   us the stamp's transaction hash.
3. We open a pull request adding `{ "name", "network", "address", "website" }`
   to `public/issuers.json`. The address must be the signing wallet's payment
   address (`addr1…` for mainnet, `addr_test1…` for test networks). Once it's
   reviewed and merged, the next site deploy (and app build) shows the school
   as verified.
4. To remove a school, or when it changes wallets, we edit the same file.
   Already-printed certificates keep verifying as stamps, and they show as
   "issuer not verified" if the wallet is no longer listed.

## Chain reads and CORS

The verify page reads one transaction through [Koios](https://koios.rest).
Koios's keyless tier doesn't send the `Access-Control-Allow-Origin` header to
browsers (tested Nov 10, 2026), so the page tries, in order:

1. **the Worker proxy** set as `workerBase` in `src/config.js` (see
   [worker/README.md](worker/README.md)). This is the **only path for normal
   browsers**. Keys come from Worker secrets and are never committed, and the
   Worker answers only the origins in `ALLOWED_ORIGINS` (empty means deny all).
2. **Koios directly.** This works in the Android app (native HTTP has no CORS
   limit) and in Node scripts.

There is deliberately no third-party CORS relay, since a relay could forge
results. Until the Worker is deployed, the verify page in a desktop or mobile
browser shows "Couldn't check right now". Every result (valid, does not match,
not found, error) always links the stamp transaction on Cardanoscan for the
right network, so anyone can check independently of our Worker.

Stamping needs no indexer at all: UTxOs come from the wallet, the fee uses
Mesh's built-in protocol parameters, and the wallet submits the transaction.

## Usage counting (no trackers)

The site sets no cookies and runs no analytics. Every stamp carries the app id
`kshot-cert-stamp` (in the CIP-190 `x-kshot` extension and the 674 memo), so
usage can be counted from the chain:

```sh
node scripts/count-usage.mjs --network preprod     # or preview / mainnet, add --json
KOIOS_TOKEN=... node scripts/count-usage.mjs        # optional Koios free-tier token
BLOCKFROST_PROJECT_ID=... node scripts/count-usage.mjs --network mainnet
```

It prints stamps (transactions), certificates (sum of Merkle leaf counts) and a
per-month breakdown. Keys are read from environment variables only.

## Develop

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (hashing, CBOR, Merkle, CIP-190 vectors, links, verify, worker)
npm run test:live    # also reads a real Preprod tx from Koios
npm run build        # static site in dist/ (relative paths: GitHub Pages, any host, Capacitor)
npx vite preview --port 4173 & node scripts/e2e-verify.mjs   # headless-Chrome verify-page check
```

Configuration lives in `src/config.js`: default network, `workerBase`,
the public verify URL used for QR codes, and the tip button
(`TIP_ENABLED`). It holds no secrets.

### GitHub Pages

A ready-made Pages workflow and a CI workflow are in
[docs/github-workflows/](docs/github-workflows/README.md). The repo owner moves
them into `.github/workflows/` and sets Settings → Pages → Source: GitHub
Actions. The site will then live at
`https://kshot3000.github.io/cardano-cert-stamp/`. Any static host works too:
just serve `dist/`.

### Android (Capacitor)

```sh
npm run android:sync   # build + copy into android/
npm run android:open   # open in Android Studio, then Run or Build → APK
```

Needs Android Studio / the Android SDK and JDK 21. The app's web assets are
bundled locally. `CapacitorHttp` is enabled so chain reads skip browser CORS,
and the manifest requests the camera for QR scanning.

## Testing status

* ✅ 99 unit tests pass, including the official CIP-190 conformance vectors
  (canonical CBOR, RFC 9162 roots and inclusion proofs, label-309 chunk
  reassembly; vectors in `test/vectors/`, Apache-2.0, from
  [cardanowall/label-309](https://github.com/cardanowall/label-309)).
* ✅ The stamp transaction builds offline with Mesh (in Node and in headless
  Chrome) and carries the expected label 309 and 674 metadata. The fee comes
  to about 0.17–0.2 ADA.
* ✅ The verify page, tested in headless Chrome on a phone-sized screen, shows
  a simulated stamp as "Stamp found, issuer not verified". The same stamp shows
  as "Valid certificate · Issued by …" once the signer is in the registry. It
  rejects an edited certificate and decodes an uploaded QR photo. With no Worker configured, it shows "Couldn't
  check" for a real Preprod lookup (no relay fallback). Every result shows the
  Cardanoscan link for the right network.
* ⏳ **Not yet done:** a real stamp on Preprod signed by a real wallet, then a
  phone scan of the printed QR. That needs a browser wallet with free test ADA.
  Mainnet stays untested until then.

## Credits and licences

MIT licensed (see `LICENSE`). Built on [Mesh](https://meshjs.dev) (Apache-2.0),
[qrcode](https://github.com/soldair/node-qrcode), jsQR, jsPDF and JSZip. The
bech32 address check follows the same approach as the one in
[Cardano4all](https://github.com/Kshot3000/Cardano4all), rewritten here. No
code from UVerify (AGPL-3.0) is used. It's compatible only through the open
CIP-190 standard.
