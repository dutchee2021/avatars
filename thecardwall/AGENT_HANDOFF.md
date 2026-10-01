# Task: deploy The Card Wall to Cloudflare at moxapp.io/thecardwall

You have Cloudflare access for the MOX account. Deploy the attached build of
**The Card Wall** (a static 3D slab viewer plus a small Worker) so it is served at
**https://moxapp.io/thecardwall/**. Deploy to a test hostname first, and to
production only as described in step 4.

The attached `thecardwall-deploy.zip` contains everything. There is nothing else to
fetch or build by hand.

**Re-run note (if you deployed an earlier zip):** the art endpoint returned
`Art unavailable: RPC HTTP 429` because Robinhood's free public RPC throttles
Cloudflare's shared outbound IPs. That is expected and **does not block
shipping**. The page then reads the chain directly from the visitor's browser,
which the public RPC allows. This zip makes the Worker retry, accept backup RPC
URLs, and answer a throttled lookup with a fast `503` +
`x-cardwall-art: unavailable`, which the page treats as "read the chain
yourself". Redeploy test with this zip, then continue at step 3. Source of record: GitHub `dutchee2021/avatars`, folder
`thecardwall/`, branch `claude/trading-card-slab-model-k1oj7e`.

## Rules

- **MOX release rule:** deploy to `moxapp.io` only if the owner's message to you
  says **"ship it"**. Otherwise stop after the test deploy (step 3) and report.
- Do not modify, redeploy or re-route the existing **`mox-pfp-feed`** Worker or its
  `moxapp.io/*` route. This build adds its own Worker, `thecardwall`, with the
  two more specific routes `moxapp.io/thecardwall` and `moxapp.io/thecardwall/*`.
  Cloudflare sends each request to the most specific matching route, so only
  `/thecardwall` paths move. Everything else stays on `mox-pfp-feed`.
- Don't edit the site files. If something fails, stop and report the exact error.
- Never print, commit or paste API tokens.

## What you are deploying

```
thecardwall/                 static site: index.html, app.css, js/, assets/, vendor/
thecardwall/worker/
  wrangler.jsonc             3 Workers: thecardwall-preview (workers.dev),
                             thecardwall-test (thecardwall-test.moxapp.io),
                             thecardwall (production routes on moxapp.io)
  src/index.js, src/lib.js   serves the site under /thecardwall/ and
                             GET /thecardwall/api/art/{stonkbrokers|interns}/{id}
                             (reads tokenURI from Robinhood Chain, edge-cached)
  scripts/build.mjs          copies the site into worker/public/thecardwall/
  scripts/test-worker.mjs    offline tests (no network, no login)
thecardwall/DEPLOY.md        full reference (checks, settings, rollback, content swaps)
```

## Step 1: Preflight

```sh
unzip thecardwall-deploy.zip && cd thecardwall/worker
node --version                       # must be v20 or newer
# Auth: either `npx wrangler@4 login`, or export CLOUDFLARE_API_TOKEN and
# CLOUDFLARE_ACCOUNT_ID. Token template "Edit Cloudflare Workers", plus
# Zone > DNS > Edit on moxapp.io (needed for the test custom domain).
npx wrangler@4 whoami                # confirm the account that owns moxapp.io
```

Check the current Workers routes on the zone:

```sh
ZONE_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=moxapp.io" | jq -r '.result[0].id')
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" | jq '.result[] | {pattern, script}'
```

Expected: `moxapp.io/*` → `mox-pfp-feed`, and **no** route starting with
`moxapp.io/thecardwall`. If one already exists for another Worker, stop and report.
Also make sure no DNS record already exists for `thecardwall-test.moxapp.io`.

## Step 2: Install, test, build

```sh
npm install          # installs wrangler 4
npm test             # must print: worker tests passed
npm run build        # writes public/thecardwall/ and public/thecardwall/build.json
```

## Step 3: Deploy to test

```sh
npm run deploy:test  # Worker "thecardwall-test" on https://thecardwall-test.moxapp.io
```

If the custom domain is refused for lack of DNS permission, use
`npm run deploy:preview` instead (`https://thecardwall-preview.<subdomain>.workers.dev`).

Verify (`HOST=thecardwall-test.moxapp.io`, or the workers.dev host):

```sh
curl -sI https://$HOST/thecardwall | grep -iE '^HTTP|^location'          # 301 -> /thecardwall/
curl -s  https://$HOST/thecardwall/build.json                            # build time + commit
curl -sI https://$HOST/thecardwall/ | grep -iE '^HTTP|content-type'       # 200 text/html
curl -sI https://$HOST/thecardwall/assets/slab.glb | grep -iE '^HTTP|content-type'   # 200 model/gltf-binary
curl -sI https://$HOST/thecardwall/api/art/stonkbrokers/4354 | grep -iE '^HTTP|content-type|x-cardwall-art'
curl -sI https://$HOST/thecardwall/api/art/interns/1807 | grep -iE '^HTTP|content-type|x-cardwall-art'
```

Each art call must return either:

- `200` with `content-type: image/...` (the Worker reached the chain), or
- `503` with `x-cardwall-art: unavailable` (the public RPC throttled
  Cloudflare; the page falls back to the browser).

Both are a pass. Anything else (`5xx` without that header, HTML, or a hang over
10 s) is a failure; read the body and `npx wrangler tail --env test`.

**Browser check (required either way):** open `https://$HOST/thecardwall/`,
press the dice 3 times, and switch to THE INTERNS. Each card must show real
pixel art, not a dark silhouette, and no "LIVE ART IS UNAVAILABLE" message may
appear. This is the real acceptance test.

Optional, for the Worker's 24 h edge cache to fill: if the owner provides a
dedicated Robinhood Chain RPC (one or more URLs, comma-separated, tried in
order), set it as a secret: `npx wrangler secret put RPC_URL --env test` and
`--env production`. Never paste the URL into files or reports.

Give the owner the test URL `https://$HOST/thecardwall/` to check on their phone.
If they did not say "ship it", stop here and report.

## Step 4: Production (only if the owner said "ship it")

```sh
npm test && npm run deploy:production   # Worker "thecardwall", routes moxapp.io/thecardwall and /thecardwall/*
```

Verify:

```sh
curl -sI https://moxapp.io/thecardwall | grep -iE '^HTTP|^location'      # 301 -> /thecardwall/
curl -s  https://moxapp.io/thecardwall/build.json                        # same commit as test
curl -sI https://moxapp.io/thecardwall/api/art/stonkbrokers/4354 | grep -iE '^HTTP|content-type|x-cardwall-art'   # 200 image/... or 503 unavailable
curl -sI https://moxapp.io/ | grep -iE '^HTTP'                           # unchanged, still mox-pfp-feed
```

Repeat the browser check from step 3 on `https://moxapp.io/thecardwall/`.

Then re-run the route listing from step 1. Expected: `moxapp.io/*` →
`mox-pfp-feed`, plus `moxapp.io/thecardwall` and `moxapp.io/thecardwall/*` →
`thecardwall`.

## Rollback

- Bad build: `npx wrangler rollback --env production` (previous version of `thecardwall`).
- Take the page down: delete the two `moxapp.io/thecardwall` routes (dashboard
  Workers Routes, or `npx wrangler delete --env production`). Those paths fall
  back to `mox-pfp-feed`, as before.

## Report back

1. Account, and the routes found in preflight.
2. `npm test` result.
3. Test URL, the output of the step 3 checks, and the browser check result.
4. Whether production was deployed. If it was, the step 4 checks and the final route list.
5. Any error, verbatim.
