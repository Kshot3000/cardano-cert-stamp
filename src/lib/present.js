// How a verify result is presented. Kept out of the page so it can be tested.
//
// Rule: we only ever say a school issued a certificate when the wallet that
// signed the stamp is in our curated issuers.json for that network. A name
// typed on the certificate (fields.issuer) is self-declared: anyone can type
// any school name, and anyone can print their own wallet address next to it.

/**
 * @returns {{ icon, heading, tone, issuerVerified, issuerName, issuerLabel, issuerNote, issuerNoteTone }}
 */
export function presentResult(r, fields = {}) {
  const declared = fields.issuer || '';
  const base = { issuerVerified: false, issuerName: declared, issuerLabel: declared ? `${declared} (self-declared, not verified)` : '—', issuerNote: null, issuerNoteTone: '' };
  switch (r.status) {
    case 'valid': {
      if (r.issuer === 'registry' && r.registryEntry) {
        const name = r.registryEntry.name;
        return { ...base, icon: '✅', heading: `Valid certificate · Issued by ${name}`, tone: 'ok', issuerVerified: true, issuerName: name, issuerLabel: `${name} (verified issuer)`,
          issuerNote: `The wallet that stamped this is listed for ${name} in our issuer registry on ${r.network}.`, issuerNoteTone: 'ok' };
      }
      const note = r.issuer === 'no_match'
        ? 'Warning: the stamp was signed by a different wallet than the one printed on the certificate.'
        : r.issuer === 'printed'
          ? 'The stamp was signed by the wallet printed on the certificate, but anyone can print their own wallet. That wallet is not in our issuer registry.'
          : 'The wallet that stamped this is not in our issuer registry.';
      return { ...base, icon: '☑️', heading: 'Stamp found, issuer not verified', tone: 'warn',
        issuerNote: `${note} The certificate matches what was stamped on Cardano and hasn't been edited, but we can't confirm who issued it. Ask the school which wallet they stamp from.`,
        issuerNoteTone: r.issuer === 'no_match' ? 'bad' : '' };
    }
    case 'not_found': return { ...base, icon: '❔', heading: 'Not found on Cardano', tone: 'warn' };
    case 'mismatch': return { ...base, icon: '❌', heading: 'Does not match', tone: 'bad' };
    default: return { ...base, icon: '⚠️', heading: "Couldn't check right now", tone: 'warn' };
  }
}
