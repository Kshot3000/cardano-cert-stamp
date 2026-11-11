# On-chain format

Cert Stamp writes **one transaction per batch**. It carries no script, token or
datum: just transaction metadata, following
[CIP-190](https://cips.cardano.org/cip/CIP-0190) (Proof of Existence, metadata
label **309**, reserved in the CIP-10 registry). CIP-190 is still a *Proposed*
standard; we follow the version published in the CIPs repo as of Nov 2026 and
test against its conformance vectors.

## Label 309: CIP-190 record

Record body, canonical CBOR (RFC 8949 §4.2.1):

```
{
  "v": 1,
  "merkle": [ { "alg": "rfc9162-sha256", "root": <32 bytes>, "leaf_count": N } ],
  "x-kshot": { "kind": "cert-batch", "ver": 1, "app": "kshot-cert-stamp", "app_ver": "0.1.0" }
}
```

On-chain the body is split into a CBOR array of byte strings of at most 64
bytes each (the CIP-190 "chunk-array transport", required by the ledger's
64-byte string limit). Verifiers concatenate the chunks and decode the body.

`x-kshot` is an extension key (allowed by CIP-190). Its `app` field is the
stable app identifier that `scripts/count-usage.mjs` counts. Any other
CIP-190 verifier can ignore it and still check the root.

## Label 674: CIP-20 memo

```
{ "msg": ["<optional public batch title, max 64 bytes>"], "app": "kshot-cert-stamp" }
```

If the issuer gives no title, `msg` is `["Certificate batch"]`. The title is
public, so the app warns never to put names in it.

## Certificate fingerprint (off-chain)

```
fields = { cert_no, recipient_name, course, date_awarded, issuer, [issuer_addr], [grade], [expires] }
d      = SHA-256( "kshot-cert-v1" || salt || canonical_json(fields) [|| pdf_sha256] )
```

* `salt`: 32 random bytes per certificate (`crypto.getRandomValues`). Names,
  courses and dates are easy to guess, so without a salt someone could test
  guesses against the chain. The salt lives only in the certificate's QR link
  and in the issuer's private backup CSV.
* `canonical_json`: keys sorted, strings Unicode NFC, trimmed, inner whitespace
  collapsed, empty optional fields dropped, no extra whitespace.
* `pdf_sha256`: optional. If the issuer binds their own PDF, the checker must
  present that exact file.

## Merkle tree

RFC 9162 §2.1 with SHA-256 (`rfc9162-sha256`): `leaf = SHA-256(0x00 || d)`,
`node = SHA-256(0x01 || left || right)`, split at the largest power of two
below `n`. Proofs are RFC 9162 audit paths and are verified with the §2.1.3.2
algorithm, using the leaf index from the link and `leaf_count` from the chain.

## Verify link (QR code)

```
verify.html#n=<mainnet|preprod|preview>&tx=<tx hash>&i=<leaf index>&s=<salt b64url>&f=<fields JSON b64url>&p=<proof b64url>[&h=<pdf sha256 b64url>]
```

Everything is in the URL fragment (`#...`), which browsers never send to the
web server. A 500-certificate batch gives a link of about 750–850 characters,
which prints as a readable QR code.

## What is never on-chain

Names, grades, course names, certificate numbers, emails, salts. Only a 32-byte
root, a count, the app id and an optional public title.
