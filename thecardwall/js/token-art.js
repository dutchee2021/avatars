// Token art loader. StonkBrokers and Interns render their art onchain, so the
// image comes from tokenURI() on Robinhood Chain. Order of attempts:
//   1. same-origin art endpoint (optional Cloudflare Worker, cached at the edge)
//   2. direct eth_call to the public RPC from the browser
// Every success resolves to a decoded <img> plus a few facts the card
// compositor needs (aspect, background colour, pixel-art hint).

import { ART_ENDPOINT, RPC_URLS, IPFS_GATEWAY } from './config.js';

const TOKEN_URI_SELECTOR = '0xc87b56dd'; // tokenURI(uint256)
const cache = new Map();

export class TokenArtError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code; // 'not_found' | 'unavailable' | 'invalid'
  }
}

/** Resolve (and memoise) the art for one token. */
export function loadTokenArt(collection, tokenId) {
  const key = `${collection.id}:${tokenId}`;
  if (!cache.has(key)) {
    const pending = fetchArt(collection, tokenId).catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
  }
  return cache.get(key);
}

async function fetchArt(collection, tokenId) {
  const failures = [];
  if (ART_ENDPOINT) {
    try {
      const res = await fetch(`${ART_ENDPOINT}${collection.id}/${tokenId}`, {
        headers: { accept: 'image/svg+xml,image/*;q=0.9' },
      });
      const type = res.headers.get('content-type') || '';
      if (res.status === 404 && res.headers.get('x-cardwall-art') === 'not-found') {
        throw new TokenArtError('not_found', `${collection.titleName} #${tokenId} does not exist`);
      }
      if (res.ok && type.startsWith('image/')) {
        const blob = await res.blob();
        return type.includes('svg') ? artFromSvgText(await blob.text()) : artFromBlob(blob);
      }
      failures.push(`endpoint ${res.status}`);
    } catch (error) {
      if (error.code === 'not_found') throw error;
      failures.push(`endpoint ${error.message}`);
    }
  }
  for (const rpc of RPC_URLS) {
    try {
      const uri = await readTokenUri(rpc, collection.contract, tokenId);
      return await artFromTokenUri(uri);
    } catch (error) {
      if (error.code === 'not_found') throw error;
      failures.push(`${new URL(rpc).host} ${error.message}`);
    }
  }
  throw new TokenArtError('unavailable', failures.join('; '));
}

// ---------------------------------------------------------------- chain read
async function readTokenUri(rpc, contract, tokenId) {
  const data = TOKEN_URI_SELECTOR + BigInt(tokenId).toString(16).padStart(64, '0');
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data }, 'latest'] }),
  });
  if (!res.ok) throw new TokenArtError('unavailable', `HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) {
    const message = `${body.error.message || ''} ${body.error.data || ''}`;
    if (/revert|nonexistent|invalid token|not minted|query for/i.test(message)) {
      throw new TokenArtError('not_found', message.trim());
    }
    throw new TokenArtError('unavailable', message.trim() || 'RPC error');
  }
  if (!body.result || body.result === '0x') throw new TokenArtError('not_found', 'empty tokenURI');
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

// ------------------------------------------------------------- uri decoding
function gatewayUrl(uri) {
  if (uri.startsWith('ipfs://')) return IPFS_GATEWAY + uri.slice(7).replace(/^ipfs\//, '');
  if (uri.startsWith('ar://')) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

function decodeDataUri(uri) {
  const comma = uri.indexOf(',');
  if (comma < 0) throw new TokenArtError('invalid', 'malformed data URI');
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  if (/;base64$/i.test(meta)) {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return { mime: meta.replace(/;.*$/, ''), bytes, text: () => new TextDecoder().decode(bytes) };
  }
  let text;
  try { text = decodeURIComponent(payload); } catch { text = payload; }
  return { mime: meta.replace(/;.*$/, ''), bytes: new TextEncoder().encode(text), text: () => text };
}

async function readJson(uri) {
  if (uri.startsWith('data:')) return JSON.parse(decodeDataUri(uri).text());
  const trimmed = uri.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const res = await fetch(gatewayUrl(uri));
  if (!res.ok) throw new TokenArtError('unavailable', `metadata HTTP ${res.status}`);
  return res.json();
}

async function artFromTokenUri(uri) {
  const meta = await readJson(uri);
  if (typeof meta.image_data === 'string' && meta.image_data.includes('<svg')) {
    return artFromSvgText(meta.image_data);
  }
  const image = meta.image || meta.image_url;
  if (!image) throw new TokenArtError('invalid', 'metadata has no image');
  if (image.startsWith('data:')) {
    const decoded = decodeDataUri(image);
    if (decoded.mime.includes('svg')) return artFromSvgText(decoded.text());
    return artFromBlob(new Blob([decoded.bytes], { type: decoded.mime }));
  }
  if (image.trim().startsWith('<svg')) return artFromSvgText(image);
  const res = await fetch(gatewayUrl(image));
  if (!res.ok) throw new TokenArtError('unavailable', `image HTTP ${res.status}`);
  const blob = await res.blob();
  return blob.type.includes('svg') ? artFromSvgText(await blob.text()) : artFromBlob(blob);
}

// ------------------------------------------------------------- image building
/**
 * Normalise an SVG for canvas drawing: explicit pixel size (some browsers
 * report 0x0 for viewBox-only SVGs) and crisp edges for pixel art so the
 * squares do not show hairline seams when scaled up.
 */
export function prepareSvg(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    throw new TokenArtError('invalid', 'token art is not valid SVG');
  }
  let [vbw, vbh] = [0, 0];
  const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) [vbw, vbh] = [viewBox[2], viewBox[3]];
  const attrW = parseFloat(svg.getAttribute('width'));
  const attrH = parseFloat(svg.getAttribute('height'));
  if (!vbw && attrW > 0 && attrH > 0) {
    [vbw, vbh] = [attrW, attrH];
    svg.setAttribute('viewBox', `0 0 ${attrW} ${attrH}`);
  }
  if (!vbw) [vbw, vbh] = [1000, 1000];
  // Render size: large enough that the browser rasterises sharply.
  const scale = Math.max(1, 1024 / Math.max(vbw, vbh));
  svg.setAttribute('width', String(Math.round(vbw * scale)));
  svg.setAttribute('height', String(Math.round(vbh * scale)));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const rects = svg.getElementsByTagName('rect').length;
  const curves = ['path', 'circle', 'ellipse', 'polygon', 'text'].reduce(
    (n, tag) => n + svg.getElementsByTagName(tag).length, 0);
  const images = [...svg.getElementsByTagName('image')];
  const pixelated = (rects >= 24 && rects > curves * 4) ||
    images.some((img) => (img.getAttribute('href') || img.getAttribute('xlink:href') || '').length < 40000);
  if (pixelated) {
    if (!svg.getAttribute('shape-rendering')) svg.setAttribute('shape-rendering', 'crispEdges');
    const style = svg.getAttribute('style') || '';
    if (!/image-rendering/.test(style)) svg.setAttribute('style', `${style};image-rendering:pixelated`.replace(/^;/, ''));
  }
  return {
    text: new XMLSerializer().serializeToString(svg),
    width: Math.round(vbw * scale),
    height: Math.round(vbh * scale),
    pixelated,
  };
}

function decodeImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new TokenArtError('invalid', 'token art could not be decoded'));
    img.src = url;
  });
}

function sampleBackground(img, width, height) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, width, height, 0, 0, 32, 32);
  try {
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a > 200 ? `rgb(${r}, ${g}, ${b})` : null;
  } catch {
    return null; // tainted (should not happen for blob URLs)
  }
}

export async function artFromSvgText(svgText) {
  const prepared = prepareSvg(svgText);
  const url = URL.createObjectURL(new Blob([prepared.text], { type: 'image/svg+xml' }));
  const image = await decodeImage(url);
  return {
    kind: 'svg',
    url,
    image,
    width: prepared.width,
    height: prepared.height,
    pixelated: prepared.pixelated,
    background: sampleBackground(image, prepared.width, prepared.height),
  };
}

export async function artFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  const image = await decodeImage(url);
  const width = image.naturalWidth || 1000;
  const height = image.naturalHeight || 1000;
  return {
    kind: 'raster',
    url,
    image,
    width,
    height,
    pixelated: Math.max(width, height) <= 256,
    background: sampleBackground(image, width, height),
  };
}

export async function artFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new TokenArtError('unavailable', `HTTP ${res.status}`);
  const blob = await res.blob();
  return blob.type.includes('svg') ? artFromSvgText(await blob.text()) : artFromBlob(blob);
}

/** Neutral stand-in shown while art loads or when the chain cannot be reached. */
export function placeholderArt() {
  const grid = [
    '................',
    '................',
    '.....######.....',
    '....########....',
    '....########....',
    '....########....',
    '....########....',
    '.....######.....',
    '......####......',
    '..############..',
    '.##############.',
    '.##############.',
    '################',
    '################',
    '################',
    '################',
  ];
  let rects = '';
  grid.forEach((row, y) => [...row].forEach((cell, x) => {
    if (cell === '#') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#1c1f23"/><g fill="#2b2f35">${rects}</g></svg>`;
  return artFromSvgText(svg);
}
