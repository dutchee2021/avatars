// Offline checks for src/index.js: routing, art decoding, not-found and
// error handling, with fetch, caches and the ASSETS binding stubbed.
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { decodeAbiString, cacheControlFor, rpcUrls } from '../src/lib.js';

const abi = (text) => {
  const hex = Buffer.from(text, 'utf8').toString('hex');
  return `0x${(32).toString(16).padStart(64, '0')}${(hex.length / 2).toString(16).padStart(64, '0')}${hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')}`;
};
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#638596"/></svg>';
const tokenUri = (id) => `data:application/json;base64,${Buffer.from(JSON.stringify({ name: `#${id}`, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` })).toString('base64')}`;

const store = new Map();
globalThis.caches = { default: { match: async (req) => store.get(req.url)?.clone(), put: async (req, res) => { store.set(req.url, res); } } };
let rpcCalls = 0;
let rpcMode = 'ok';
const hosts = [];
let rateLimitsLeft = 0;
globalThis.fetch = async (url, init) => {
  rpcCalls++;
  hosts.push(new URL(url).host);
  const body = JSON.parse(init.body);
  const id = parseInt(body.params[0].data.slice(10), 16);
  if (rpcMode === 'down') return new Response('busy', { status: 503 });
  if (rpcMode === 'public-limited' && new URL(url).host === 'rpc.mainnet.chain.robinhood.com') return new Response('slow down', { status: 429 });
  if (rateLimitsLeft > 0) { rateLimitsLeft--; return new Response('slow down', { status: 429 }); }
  if (id > 4444) return Response.json({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted', data: '0x7e273289' } });
  return Response.json({ jsonrpc: '2.0', id: 1, result: abi(tokenUri(id)) });
};
const env = { ASSETS: { fetch: async (req) => new Response(`asset ${new URL(req.url).pathname}`, { headers: { 'content-type': 'text/html', etag: '"x"' } }) } };
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };
const get = (path) => worker.fetch(new Request(`https://moxapp.io${path}`), env, ctx);

assert.equal(decodeAbiString(abi('héllo')), 'héllo');

let res = await get('/thecardwall');
assert.equal(res.status, 301);
assert.equal(res.headers.get('location'), 'https://moxapp.io/thecardwall/');

res = await get('/thecardwall/?collection=interns&token=7');
assert.equal(res.status, 200);
assert.equal(res.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
assert.equal(cacheControlFor('/thecardwall/assets/fonts/a.woff2'), 'public, max-age=31536000, immutable');
assert.equal(cacheControlFor('/thecardwall/assets/card-back.png'), 'public, max-age=300');

res = await get('/thecardwall/api/art/stonkbrokers/4354');
assert.equal(res.status, 200);
assert.equal(res.headers.get('content-type'), 'image/svg+xml');
assert.match(res.headers.get('content-security-policy'), /sandbox/);
assert.equal(await res.text(), svg);
await Promise.all(pending);
const callsAfterFirst = rpcCalls;
res = await get('/thecardwall/api/art/stonkbrokers/04354'); // same cache entry
assert.equal(res.status, 200);
assert.equal(rpcCalls, callsAfterFirst, 'second request is served from the cache');

res = await get('/thecardwall/api/art/interns/9999');
assert.equal(res.status, 404);
assert.equal(res.headers.get('x-cardwall-art'), 'not-found');

res = await get('/thecardwall/api/art/punks/1');
assert.equal(res.status, 404);

// One 429 is retried on the same endpoint.
rateLimitsLeft = 1;
res = await get('/thecardwall/api/art/interns/21');
assert.equal(res.status, 200);

// A throttled public RPC falls through to the next endpoint in RPC_URL; the
// error text never includes full URLs (they can carry API keys).
assert.deepEqual(rpcUrls(' https://a.example/key1 , https://b.example '), ['https://a.example/key1', 'https://b.example']);
assert.deepEqual(rpcUrls(''), ['https://rpc.mainnet.chain.robinhood.com']);
rpcMode = 'public-limited';
hosts.length = 0;
const envWithBackup = { ...env, RPC_URL: 'https://rpc.mainnet.chain.robinhood.com,https://backup.example/secret-key' };
res = await worker.fetch(new Request('https://moxapp.io/thecardwall/api/art/interns/22'), envWithBackup, ctx);
assert.equal(res.status, 200);
assert.deepEqual(hosts, ['rpc.mainnet.chain.robinhood.com', 'rpc.mainnet.chain.robinhood.com', 'backup.example']);

// Every endpoint down: a fast 503 the page recognises, nothing cached, no keys leaked.
rpcMode = 'down';
res = await worker.fetch(new Request('https://moxapp.io/thecardwall/api/art/interns/12'), envWithBackup, ctx);
assert.equal(res.status, 503);
assert.equal(res.headers.get('x-cardwall-art'), 'unavailable');
assert.equal(res.headers.get('cache-control'), 'no-store');
assert.doesNotMatch(await res.text(), /secret-key/);

res = await worker.fetch(new Request('https://moxapp.io/thecardwall/api/art/interns/12', { method: 'POST' }), env, ctx);
assert.equal(res.status, 405);

console.log('worker tests passed');
