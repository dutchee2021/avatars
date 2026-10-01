// The Card Wall on Cloudflare: serves the static site under /thecardwall/
// and a cached, same-origin token art endpoint
//   GET /thecardwall/api/art/{stonkbrokers|interns}/{tokenId}
// that reads tokenURI() from Robinhood Chain and returns the token's image.
// The page falls back to calling the public RPC itself when this endpoint
// is missing, so the endpoint is an optimisation (edge cache, no CORS or
// rate-limit exposure in browsers), not a hard dependency.

const PREFIX = '/thecardwall';
const CONTRACTS = {
  stonkbrokers: '0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0',
  interns: '0xfc4b0c4f464dc3037cf013934648a8a726d565a5',
};
const DEFAULT_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
const TOKEN_URI_SELECTOR = '0xc87b56dd'; // tokenURI(uint256)
const ART_EDGE_TTL = 86400; // found art, seconds at the edge
const MISSING_EDGE_TTL = 120; // unminted tokens can be minted later
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Token art is third-party markup served from our origin: never let it run.
const ART_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox";

export class ArtError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code; // 'not_found' | 'unavailable' | 'invalid'
  }
}

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

export function cacheControlFor(path) {
  if (path.includes('/assets/fonts/')) return 'public, max-age=31536000, immutable';
  if (path.includes('/vendor/')) return 'public, max-age=86400';
  // Card art, label and model files can be swapped before launch.
  if (path.includes('/assets/')) return 'public, max-age=300';
  // HTML, CSS and app modules revalidate on every load (cheap 304s).
  return 'public, max-age=0, must-revalidate';
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
    const uri = await readTokenUri(env.RPC_URL || DEFAULT_RPC, contract, tokenId);
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
      return text(`Art unavailable: ${error.message}`, 502, { 'cache-control': 'no-store' });
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

export async function readTokenUri(rpc, contract, tokenId) {
  const data = TOKEN_URI_SELECTOR + BigInt(tokenId).toString(16).padStart(64, '0');
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data }, 'latest'] }),
  });
  if (!res.ok) throw new ArtError('unavailable', `RPC HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) {
    const message = `${body.error.message || ''} ${typeof body.error.data === 'string' ? body.error.data : ''}`.trim();
    if (/revert|nonexistent|invalid token|not minted|query for/i.test(message)) throw new ArtError('not_found', message);
    throw new ArtError('unavailable', message || 'RPC error');
  }
  if (!body.result || body.result === '0x') throw new ArtError('not_found', 'empty tokenURI');
  return decodeAbiString(body.result);
}

export function decodeAbiString(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const offset = parseInt(h.slice(0, 64), 16) * 2;
  const length = parseInt(h.slice(offset, offset + 64), 16);
  const start = offset + 64;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = parseInt(h.substr(start + i * 2, 2), 16);
  return new TextDecoder().decode(bytes);
}

function decodeDataUri(uri) {
  const comma = uri.indexOf(',');
  if (comma < 0) throw new ArtError('invalid', 'malformed data URI');
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  const mime = meta.replace(/;.*$/, '').toLowerCase();
  if (/;base64$/i.test(meta)) {
    const binary = atob(payload);
    return { mime, bytes: Uint8Array.from(binary, (c) => c.charCodeAt(0)) };
  }
  let decoded;
  try { decoded = decodeURIComponent(payload); } catch { decoded = payload; }
  return { mime, bytes: new TextEncoder().encode(decoded) };
}

function gatewayUrl(uri) {
  if (uri.startsWith('ipfs://')) return IPFS_GATEWAY + uri.slice(7).replace(/^ipfs\//, '');
  if (uri.startsWith('ar://')) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

async function readJson(uri) {
  if (uri.startsWith('data:')) return JSON.parse(new TextDecoder().decode(decodeDataUri(uri).bytes));
  if (uri.trim().startsWith('{')) return JSON.parse(uri);
  const res = await fetch(gatewayUrl(uri), { cf: { cacheTtl: ART_EDGE_TTL, cacheEverything: true } });
  if (!res.ok) throw new ArtError('unavailable', `metadata HTTP ${res.status}`);
  return res.json();
}

const svgImage = (markup) => ({ type: 'image/svg+xml', body: new TextEncoder().encode(markup) });

export async function imageFromTokenUri(uri) {
  const meta = await readJson(uri);
  if (typeof meta.image_data === 'string' && meta.image_data.includes('<svg')) return svgImage(meta.image_data);
  const image = meta.image || meta.image_url;
  if (typeof image !== 'string' || !image) throw new ArtError('invalid', 'metadata has no image');
  if (image.startsWith('data:')) {
    const decoded = decodeDataUri(image);
    if (!decoded.mime.startsWith('image/')) throw new ArtError('invalid', `not an image: ${decoded.mime}`);
    return { type: decoded.mime, body: decoded.bytes };
  }
  if (image.trim().startsWith('<svg')) return svgImage(image.trim());
  const res = await fetch(gatewayUrl(image), { cf: { cacheTtl: ART_EDGE_TTL, cacheEverything: true } });
  if (!res.ok) throw new ArtError('unavailable', `image HTTP ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) throw new ArtError('invalid', `not an image: ${type || 'unknown'}`);
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_IMAGE_BYTES) throw new ArtError('invalid', 'image too large');
  return { type, body };
}
