# Task: deploy The Card Wall to Cloudflare at moxapp.io/thecardwall

You have Cloudflare access for the MOX account. Deploy the attached build of
**The Card Wall** (a static 3D slab viewer plus a small Worker) so it is served at
**https://moxapp.io/thecardwall/**. Deploy to a test hostname first, and to
production only as described in step 4.

The attached `thecardwall-deploy.zip` contains everything. There is nothing else to
fetch or build by hand. Source of record: GitHub `dutchee2021/avatars`, folder
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
curl -sI https://$HOST/thecardwall/api/art/stonkbrokers/4354 | grep -iE '^HTTP|content-type'  # 200 image/...
curl -sI https://$HOST/thecardwall/api/art/interns/1807 | grep -iE '^HTTP|content-type'       # 200 image/...
curl -sI https://$HOST/thecardwall/api/art/interns/9999999 | grep -iE '^HTTP|x-cardwall-art' # 404 + not-found
```

If an art call returns `502`, read the body and `npx wrangler tail --env test`. The
public Robinhood RPC is rate limited. If needed, set a dedicated endpoint with
`npx wrangler secret put RPC_URL --env test` (same for `--env production`).

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
curl -sI https://moxapp.io/thecardwall/api/art/stonkbrokers/4354 | grep -iE '^HTTP|content-type'   # 200 image/...
curl -sI https://moxapp.io/ | grep -iE '^HTTP'                           # unchanged, still mox-pfp-feed
```

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
3. Test URL, plus the output of the step 3 checks.
4. Whether production was deployed. If it was, the step 4 checks and the final route list.
5. Any error, verbatim.
