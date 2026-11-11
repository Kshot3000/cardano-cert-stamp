# Optional read proxy (Cloudflare Worker)

Why: Koios's no-key public tier answers CORS preflights but leaves
`Access-Control-Allow-Origin` off real responses (tested Nov 10, 2026), so a
browser page on GitHub Pages can't read it directly. The verify page then falls
back to a public CORS relay. This Worker is the cleaner, self-controlled option.

It proxies **one** read call (`tx_info` for one tx hash), adds CORS headers for
the origins in `ALLOWED_ORIGINS`, and can fail over to Blockfrost. It never
sees certificate data: only the public tx hash.

Not needed for the Android app (Capacitor's native HTTP has no CORS limit).

## Deploy (account owner only)

```sh
cd worker
npx wrangler login                      # your own Cloudflare account
npx wrangler secret put KOIOS_TOKEN     # optional, free Koios tier token
npx wrangler secret put BLOCKFROST_PREPROD   # optional failover
npx wrangler deploy
```

Then set `workerBase` in `src/config.js` to the Worker URL and rebuild.
Free tiers: Workers 100,000 requests/day; Koios free tier 50,000/day;
Blockfrost free 50,000/day.
