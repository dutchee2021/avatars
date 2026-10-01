# Deploying The Card Wall to Cloudflare

Instructions for the agent (or person) who puts this build on Cloudflare.
The site lives at **https://moxapp.io/thecardwall/** and is served by its own
Worker, `thecardwall`, using Workers Static Assets. It does not touch the
existing `mox-pfp-feed` Worker that owns `moxapp.io/*`.

> **Release rule (MOX):** never deploy to `moxapp.io` until the owner says
> **"ship it"**. Until then, deploy only to the test hostname or workers.dev.

## What gets deployed

```
thecardwall/                  the static site (index.html, app.css, js/, assets/, vendor/)
thecardwall/worker/
  wrangler.jsonc              Worker config: default (workers.dev), env.test, env.production
  src/index.js                the Worker: static assets + /thecardwall/api/art/{collection}/{id}
  src/lib.js                  tokenURI reader, image decoding and cache policy used by index.js
  scripts/build.mjs           copies the site into worker/public/thecardwall/ (generated, git-ignored)
  scripts/test-worker.mjs     offline checks for the Worker (no network, no Cloudflare login)
```

The Worker does three things:

1. Redirects `/thecardwall` to `/thecardwall/` (the page uses relative URLs).
2. Serves the site's files with cache headers (`index.html`, CSS and JS
   revalidate on every load; `assets/*` cache 5 minutes; `vendor/*` 1 day;
   fonts 1 year).
3. Answers `GET /thecardwall/api/art/{stonkbrokers|interns}/{tokenId}`: it calls
   `tokenURI(tokenId)` on Robinhood Chain (chain ID 4663), decodes the onchain
   metadata and returns the token image (SVG or raster), cached at the edge for
   24 hours. An unminted token returns `404` with the header
   `x-cardwall-art: not-found`, which the page shows as "NOT MINTED YET". If the
   chain is unreachable it returns `502` and the page falls back to calling the
   RPC from the browser, then to a placeholder.

Contracts (also in `js/config.js`):

| Collection | Contract (Robinhood Chain) |
| --- | --- |
| StonkBrokers | `0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0` |
| The Interns | `0xfc4b0c4f464dc3037cf013934648a8a726d565a5` |

## Prerequisites

- Node.js 20 or newer.
- Access to the Cloudflare account that holds the `moxapp.io` zone.
- Either `npx wrangler login`, or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
  in the environment. A token made from the **Edit Cloudflare Workers**
  template works for workers.dev and routes. The test deploy below uses a
  Workers **Custom Domain**, which also needs **Zone › DNS › Edit** on
  `moxapp.io`; without it, use the workers.dev preview instead.

## 1. Check and build

```sh
cd thecardwall/worker
npm install            # installs wrangler 4 (dev dependency)
npm test               # offline Worker checks; must print "worker tests passed"
npm run build          # writes public/thecardwall/ and public/thecardwall/build.json
```

`build.json` records the git commit and build time, so you can confirm which
build a hostname is serving.

## 2. Deploy to test (safe at any time)

Pick one:

```sh
npm run deploy:test       # https://thecardwall-test.moxapp.io/thecardwall/
npm run deploy:preview    # https://thecardwall.<account-subdomain>.workers.dev/thecardwall/
```

The test hostname is created by the custom-domain route in `env.test`
(change the hostname in `wrangler.jsonc` if you prefer another). Both commands
rebuild `public/` first.

### Verify the test deploy

Replace `$HOST` with the hostname you deployed to.

```sh
curl -sI https://$HOST/thecardwall                      # 301, location: /thecardwall/
curl -s  https://$HOST/thecardwall/build.json           # commit = the one you built
curl -sI https://$HOST/thecardwall/assets/slab.glb      # 200, content-type: model/gltf-binary
curl -sI https://$HOST/thecardwall/api/art/stonkbrokers/4354   # 200, content-type: image/...
curl -sI https://$HOST/thecardwall/api/art/interns/9999999     # 404 + x-cardwall-art: not-found
```

If the art endpoint returns `502`, read the reason in the body and in
`npx wrangler tail` (add `--env test` for the test Worker). The public RPC is
rate limited; set a dedicated endpoint as a secret (see "Settings").

Then check by hand (owner's phone and a desktop browser):

- [ ] Page loads with the IRL IS THE ALPHA loader, then the slab turns slowly;
      drag rotates it, pinch / scroll zooms.
- [ ] Title reads `THECARDWALL.COM` / `STONKBROKER #4354`.
- [ ] Bottom bar: tapping `STONKBROKERS` or the chevron opens the compact
      menu; picking `THE INTERNS` changes the title to `INTERN #…`, the label to
      `$STONKBROKER INTERNS` and the cart link to the Interns contract.
- [ ] Token field: typing an ID and pressing Enter loads that token's art,
      label number and ribbon number. The dice loads a random minted token.
- [ ] Cart opens `https://opensea.io/item/robinhood/<contract>/<id>`; CLAW MACHINE
      opens `https://thecardwall.com/alley`.
- [ ] Download: the share sheet shows LOADING %, then DOWNLOAD VIDEO saves a
      1080 x 1080, 6-second MP4 that loops seamlessly on black.
- [ ] AR on iPhone (Safari): AR Quick Look opens; the slab lies flat, face up,
      on the table or floor.
- [ ] AR on Android (Chrome, ARCore phone): the WebXR session opens with the
      slab lying flat. If the first tap says "AR IS READY. TAP AR AGAIN.", that
      is expected right after changing tokens.
- [ ] AR on desktop: a QR code opens; scanning it on a phone opens the same
      collection and token with the AR button highlighted.

## 3. Deploy to production (only after "ship it")

1. In the Cloudflare dashboard, **moxapp.io › Workers Routes**: confirm that no
   other Worker already has a `moxapp.io/thecardwall*` route. The existing
   `moxapp.io/*` route of `mox-pfp-feed` stays as it is; Cloudflare sends a
   request to the most specific matching route, so only `/thecardwall` and
   `/thecardwall/*` move to this Worker.
2. Deploy:

   ```sh
   cd thecardwall/worker
   npm test && npm run deploy:production
   ```

3. Verify with the same `curl` checks against `moxapp.io`, plus:

   ```sh
   curl -sI https://moxapp.io/              # still served by mox-pfp-feed (unchanged)
   curl -s  https://moxapp.io/thecardwall/build.json
   ```

### Roll back

- `npx wrangler rollback --env production` restores the previous version of the
  `thecardwall` Worker.
- To take the page down completely, remove the two `moxapp.io/thecardwall`
  routes (dashboard, or `npx wrangler delete --env production`). Requests then
  fall through to `mox-pfp-feed` as before.

## Settings

| Setting | How | Default |
| --- | --- | --- |
| Dedicated RPC endpoint for the art endpoint | `npx wrangler secret put RPC_URL --env production` (and `--env test`) | `https://rpc.mainnet.chain.robinhood.com` |
| Test hostname | `env.test.routes` in `wrangler.jsonc` | `thecardwall-test.moxapp.io` |
| Edge cache for token art | `ART_EDGE_TTL` in `worker/src/lib.js` | 24 hours |

Cached art can be cleared early with **Caching › Purge by URL** for
`https://moxapp.io/thecardwall/api/art/<collection>/<id>`.

## Updating content before launch

All of these are plain file swaps followed by `npm run deploy:test` (or
`deploy:production` after "ship it"). Files under `assets/` reach browsers
within 5 minutes.

| Change | File | Notes |
| --- | --- | --- |
| Final card back (same for every card) | `thecardwall/assets/card-back.png` | 1000 x 1400 px PNG (any 5:7 image works). |
| Card front frame | `thecardwall/assets/card-template-front.png` | 750 x 1050 px PNG, transparent art window. Art is placed by `js/card.js` (bottom-aligned to the frame's black outline). |
| Licensed Franklin Gothic Heavy for the ribbon number | add `thecardwall/assets/fonts/franklin-gothic-heavy.woff2` and the `@font-face` below to `app.css` | The card compositor switches to it automatically at the specified 16 pt (66.7 px at 300 dpi). Until then it uses Libre Franklin Black (OFL), fitted to the sample. |
| Label text | `LABEL` and `COLLECTIONS[*].labelName` in `js/config.js` | `#4354` and the collection line update per token automatically. |
| Token ID ranges | `minId` / `maxId` in `js/config.js` | Used by the input check and the dice. |
| Slab model | `thecardwall/assets/slab.glb` | Export from `slab/build_slab.py`; keep the material names (`Card_Front`, `Card_Back`, `Label_Front`, `Label_Back`, ...). |

```css
@font-face {
  font-family: 'Franklin Gothic Heavy';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url('assets/fonts/franklin-gothic-heavy.woff2') format('woff2');
}
```

Only add a font file that MOX has a **web** license for.
