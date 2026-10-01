// The Card Wall on Cloudflare: serves the static site under /thecardwall/
// and a cached, same-origin token art endpoint
//   GET /thecardwall/api/art/{stonkbrokers|interns}/{tokenId}
// that reads tokenURI() from Robinhood Chain and returns the token's image.
// The page falls back to calling the public RPC itself when this endpoint
// is missing, so the endpoint is an optimisation (edge cache, no CORS or
// rate-limit exposure in browsers), not a hard dependency.

import {
  ART_CSP, ART_EDGE_TTL, CONTRACTS, MISSING_EDGE_TTL,
  cacheControlFor, imageFromTokenUri, readTokenUri, rpcUrls,
} from './lib.js';

const PREFIX = '/thecardwall';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === PREFIX) {
      // "/" only reaches this Worker on a test hostname bound to it whole.
      return Response.redirect(new URL(`${PREFIX}/${url.search}`, url).toString(), 301);
    }
    const art = /^\/thecardwall\/api\/art\/([a-z]+)\/(\d{1,7})\/?$/.exec(url.pathname);
    if (art) return serveArt(request, env, ctx, art[1], art[2]);
    if (url.pathname.startsWith(`${PREFIX}/api/`)) return text('Not found', 404);
    return serveAsset(request, env, url);
  },
};

// ------------------------------------------------------------------ assets
async function serveAsset(request, env, url) {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  if (response.ok) headers.set('cache-control', cacheControlFor(url.pathname));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// --------------------------------------------------------------------- art
async function serveArt(request, env, ctx, collection, rawId) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const contract = CONTRACTS[collection];
  if (!contract) return missing('Unknown collection');
  const tokenId = BigInt(rawId).toString();
  const cache = caches.default;
  const cacheKey = new Request(new URL(`${PREFIX}/api/art/${collection}/${tokenId}`, request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let response;
  try {
    const uri = await readTokenUri(rpcUrls(env.RPC_URL), contract, tokenId);
    const image = await imageFromTokenUri(uri);
    response = new Response(image.body, {
      headers: {
        'content-type': image.type,
        'cache-control': `public, max-age=3600, s-maxage=${ART_EDGE_TTL}`,
        'content-security-policy': ART_CSP,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error.code !== 'not_found') {
      console.warn(`art ${collection}/${tokenId}: ${error.message}`);
      // The page then reads the chain from the browser instead.
      return text(`Art unavailable: ${error.message}`, 503, {
        'x-cardwall-art': 'unavailable',
        'retry-after': '30',
        'cache-control': 'no-store',
      });
    }
    response = missing(`${collection} #${tokenId} is not minted`);
  }
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function missing(message) {
  // The page reads this header to tell "not minted" from "endpoint absent".
  return text(message, 404, {
    'x-cardwall-art': 'not-found',
    'cache-control': `public, max-age=60, s-maxage=${MISSING_EDGE_TTL}`,
  });
}

function text(body, status, headers = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } });
}
