// Pixel Studio: a 120 x 120 pixel editor for StonkBroker and Intern art with a
// live preview on The Card Wall slab. It reuses the site's own modules, so the
// preview is exactly what the card compositor, label and 3D slab produce.

import { COLLECTIONS, DEFAULT_TOKEN_ID, displayName } from '../thecardwall/js/config.js';
import { SlabScene } from '../thecardwall/js/scene.js';
import { loadTokenArt, artFromUrl } from '../thecardwall/js/token-art.js';
import {
  composeCardFront, loadCardBack, loadCardFonts, loadCardTemplate, TEMPLATE, ART,
} from '../thecardwall/js/card.js';
import { drawLabelFront, drawLabelBack, loadLabelArtwork, loadLabelFont } from '../thecardwall/js/label.js';

const N = 120; // art grid: 24 x 24 blocks of 5 x 5
const BLOCK = 5;
const SAVE_KEY = 'pixelStudio.v1';
const $ = (id) => document.getElementById(id);

const els = {
  form: $('tokenForm'), collection: $('collection'), tokenId: $('tokenId'),
  wrap: $('canvasWrap'), grid: $('grid'), palette: $('palette'), status: $('status'),
  well: $('colourWell'), hex: $('hex'), block: $('blockMode'), lines: $('gridLines'), guide: $('frameGuide'),
  undo: $('undo'), redo: $('redo'), stage: $('stage'), spin: $('spin'),
  front: $('viewFront'), back: $('viewBack'), png: $('savePng'), pngLarge: $('savePngLarge'), svg: $('saveSvg'),
  toast: $('toast'),
};

// ------------------------------------------------------------------ state
const pixels = new Uint8ClampedArray(N * N * 4);
const artCanvas = Object.assign(document.createElement('canvas'), { width: N, height: N });
const artCtx = artCanvas.getContext('2d', { willReadFrequently: true });
const state = {
  collection: COLLECTIONS.stonkbrokers,
  tokenId: DEFAULT_TOKEN_ID,
  tool: 'pencil',
  colour: [0xd7, 0x26, 0x2e],
  block: false,
  lines: true,
  guide: true,
  zoom: 6,
  undo: [],
  redo: [],
  stroke: null,
  gridNote: '',
};
let template = null; // card frame for the guide overlay

const hex2 = (n) => n.toString(16).padStart(2, '0');
const toHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
function parseHex(text) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(text).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const cellIndex = (x, y) => (y * N + x) * 4;
const cellHex = (x, y) => {
  const i = cellIndex(x, y);
  return toHex(pixels[i], pixels[i + 1], pixels[i + 2]);
};

function toast(message, ms = 2600) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('show'), ms);
}

// ---------------------------------------------------------- grid drawing
function syncArtCanvas() {
  artCtx.putImageData(new ImageData(pixels.slice(), N, N), 0, 0);
}

function fitZoom() {
  const width = els.wrap.clientWidth - 4;
  const height = Math.max(240, window.innerHeight - 260);
  state.zoom = Math.max(3, Math.min(12, Math.floor(Math.min(width, Math.max(height, width * 0.6)) / N)));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const size = N * state.zoom;
  els.grid.width = Math.round(size * dpr);
  els.grid.height = Math.round(size * dpr);
  els.grid.style.width = `${size}px`;
  els.grid.style.height = `${size}px`;
  render();
}

function render() {
  const ctx = els.grid.getContext('2d');
  const scale = els.grid.width / N; // device px per cell
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, els.grid.width, els.grid.height);
  ctx.drawImage(artCanvas, 0, 0, els.grid.width, els.grid.height);

  if (state.guide && template) {
    // The card frame drawn over the art, in the art's own cell units.
    const cell = ART.height / N; // template px per cell
    const left = ART.centerX - ART.height / 2;
    const top = ART.bottom - ART.height;
    const dx = ((0 - left) / cell) * scale;
    const dy = ((0 - top) / cell) * scale;
    const dw = (TEMPLATE.width / cell) * scale;
    const dh = (TEMPLATE.height / cell) * scale;
    ctx.globalAlpha = 0.55;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(template, dx, dy, dw, dh);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(5, 6, 7, 0.6)'; // outside the card entirely
    ctx.fillRect(0, 0, Math.max(0, dx), els.grid.height);
    ctx.fillRect(dx + dw, 0, els.grid.width - dx - dw, els.grid.height);
  }

  if (state.lines && state.zoom >= 4) {
    ctx.lineWidth = 1;
    for (let i = 1; i < N; i++) {
      const p = Math.round(i * scale) + 0.5;
      ctx.strokeStyle = i % BLOCK === 0 ? 'rgba(0, 0, 0, 0.32)' : 'rgba(0, 0, 0, 0.12)';
      ctx.beginPath();
      ctx.moveTo(p, 0); ctx.lineTo(p, els.grid.height);
      ctx.moveTo(0, p); ctx.lineTo(els.grid.width, p);
      ctx.stroke();
    }
  }
}

// -------------------------------------------------------------- palette
let paletteTimer;
function refreshPalette() {
  clearTimeout(paletteTimer);
  paletteTimer = setTimeout(() => {
    const counts = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
      const key = toHex(pixels[i], pixels[i + 1], pixels[i + 2]);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const current = toHex(...state.colour);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 48);
    els.palette.replaceChildren(...top.map(([hex, count]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `swatch${hex === current ? ' current' : ''}`;
      b.style.background = hex;
      b.title = `${hex} (${count} px)`;
      b.setAttribute('aria-label', hex);
      b.addEventListener('click', () => setColour(parseHex(hex)));
      return b;
    }));
  }, 120);
}

function setColour(rgb, { fromHex = false } = {}) {
  state.colour = rgb;
  const hex = toHex(...rgb);
  els.well.value = hex.toLowerCase();
  if (!fromHex) els.hex.value = hex;
  els.hex.classList.remove('invalid');
  refreshPalette();
}

// ---------------------------------------------------------------- status
function baseStatus() {
  return `${displayName(state.collection, state.tokenId)}  ·  120 × 120${state.gridNote ? `  ·  ${state.gridNote}` : ''}`;
}
function setStatus(extra = '') {
  els.status.textContent = extra ? `${baseStatus()}  ·  ${extra}` : baseStatus();
}

// ---------------------------------------------------------------- history
function snapshot() {
  state.undo.push(pixels.slice());
  if (state.undo.length > 200) state.undo.shift();
  state.redo.length = 0;
  updateHistoryButtons();
}
function restore(from, to) {
  if (!from.length) return;
  to.push(pixels.slice());
  pixels.set(from.pop());
  changed();
  updateHistoryButtons();
}
function updateHistoryButtons() {
  els.undo.disabled = !state.undo.length;
  els.redo.disabled = !state.redo.length;
}

// --------------------------------------------------------------- editing
function paintCell(x, y) {
  const [r, g, b] = state.colour;
  const x0 = state.block ? Math.floor(x / BLOCK) * BLOCK : x;
  const y0 = state.block ? Math.floor(y / BLOCK) * BLOCK : y;
  const size = state.block ? BLOCK : 1;
  for (let yy = y0; yy < y0 + size; yy++) {
    for (let xx = x0; xx < x0 + size; xx++) {
      const i = cellIndex(xx, yy);
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
    }
  }
}

function paintLine(a, b) {
  // Bresenham, so fast strokes leave no gaps.
  let [x0, y0] = a;
  const [x1, y1] = b;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    paintCell(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function floodFill(x, y) {
  const i0 = cellIndex(x, y);
  const target = [pixels[i0], pixels[i0 + 1], pixels[i0 + 2]];
  const [r, g, b] = state.colour;
  if (target[0] === r && target[1] === g && target[2] === b) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
    const i = cellIndex(cx, cy);
    if (pixels[i] !== target[0] || pixels[i + 1] !== target[1] || pixels[i + 2] !== target[2]) continue;
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

function pickAt(x, y) {
  const i = cellIndex(x, y);
  setColour([pixels[i], pixels[i + 1], pixels[i + 2]]);
}

function cellFromEvent(event) {
  const rect = els.grid.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * N);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * N);
  return x >= 0 && y >= 0 && x < N && y < N ? [x, y] : null;
}

els.grid.addEventListener('contextmenu', (event) => event.preventDefault());
els.grid.addEventListener('pointerdown', (event) => {
  const cell = cellFromEvent(event);
  if (!cell) return;
  const tool = event.altKey || event.button === 2 ? 'picker' : state.tool;
  if (tool === 'picker') {
    pickAt(...cell);
    return;
  }
  snapshot();
  if (tool === 'fill') {
    floodFill(...cell);
    changed();
    return;
  }
  els.grid.setPointerCapture(event.pointerId);
  state.stroke = cell;
  paintCell(...cell);
  changed({ live: true });
});
els.grid.addEventListener('pointermove', (event) => {
  const cell = cellFromEvent(event);
  if (cell) setStatus(`CELL ${cell[0]}, ${cell[1]}  ${cellHex(...cell)}`);
  if (!state.stroke || !cell) return;
  if (cell[0] === state.stroke[0] && cell[1] === state.stroke[1]) return;
  paintLine(state.stroke, cell);
  state.stroke = cell;
  changed({ live: true });
});
const endStroke = () => {
  if (!state.stroke) return;
  state.stroke = null;
  changed();
};
els.grid.addEventListener('pointerup', endStroke);
els.grid.addEventListener('pointercancel', endStroke);
els.grid.addEventListener('pointerleave', () => { if (!state.stroke) setStatus(); });

// ---------------------------------------------------------------- tools UI
function setTool(tool) {
  state.tool = tool;
  for (const b of document.querySelectorAll('[data-tool]')) {
    const on = b.dataset.tool === tool;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}
for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));

function bindToggle(button, key, after) {
  button.addEventListener('click', () => {
    state[key] = !state[key];
    button.classList.toggle('on', state[key]);
    button.setAttribute('aria-pressed', String(state[key]));
    after?.();
  });
}
bindToggle(els.block, 'block');
bindToggle(els.lines, 'lines', render);
bindToggle(els.guide, 'guide', render);

els.well.addEventListener('input', () => setColour(parseHex(els.well.value)));
els.hex.addEventListener('input', () => {
  const rgb = parseHex(els.hex.value);
  els.hex.classList.toggle('invalid', !rgb);
  if (rgb) setColour(rgb, { fromHex: true });
});
els.hex.addEventListener('blur', () => { els.hex.value = toHex(...state.colour); els.hex.classList.remove('invalid'); });
els.undo.addEventListener('click', () => restore(state.undo, state.redo));
els.redo.addEventListener('click', () => restore(state.redo, state.undo));

document.addEventListener('keydown', (event) => {
  if (event.target.closest('input, select')) return;
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) restore(state.redo, state.undo);
    else restore(state.undo, state.redo);
  } else if (mod && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    restore(state.redo, state.undo);
  } else if (!mod) {
    const tool = { b: 'pencil', g: 'fill', i: 'picker' }[event.key.toLowerCase()];
    if (tool) setTool(tool);
  }
});

// ------------------------------------------------------------- persistence
let saveTimer;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      let binary = '';
      for (let i = 0; i < pixels.length; i += 0x8000) binary += String.fromCharCode(...pixels.subarray(i, i + 0x8000));
      localStorage.setItem(SAVE_KEY, JSON.stringify({ c: state.collection.id, id: state.tokenId, px: btoa(binary) }));
    } catch {
      // storage unavailable (private mode): editing still works
    }
  }, 400);
}
function restoreSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!saved || !COLLECTIONS[saved.c]) return false;
    const bytes = Uint8Array.from(atob(saved.px), (c) => c.charCodeAt(0));
    if (bytes.length !== pixels.length) return false;
    pixels.set(bytes);
    state.collection = COLLECTIONS[saved.c];
    state.tokenId = saved.id;
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ token art
/** Sample token art onto the 120 x 120 grid at cell centres. */
function rasterise(art) {
  const S = N * 10;
  const big = Object.assign(document.createElement('canvas'), { width: S, height: S });
  const ctx = big.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = art.background || '#000000';
  ctx.fillRect(0, 0, S, S);
  ctx.imageSmoothingEnabled = !art.pixelated;
  const w = (S * art.width) / art.height;
  ctx.drawImage(art.image, (S - w) / 2, 0, w, S);
  const data = ctx.getImageData(0, 0, S, S).data;
  let blended = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const at = (px, py) => (py * S + px) * 4;
      const c = at(x * 10 + 5, y * 10 + 5);
      const o = cellIndex(x, y);
      pixels[o] = data[c]; pixels[o + 1] = data[c + 1]; pixels[o + 2] = data[c + 2]; pixels[o + 3] = 255;
      // Is the cell one flat colour? (corners vs centre)
      for (const [px, py] of [[x * 10 + 1, y * 10 + 1], [x * 10 + 8, y * 10 + 8]]) {
        const k = at(px, py);
        if (Math.abs(data[k] - data[c]) + Math.abs(data[k + 1] - data[c + 1]) + Math.abs(data[k + 2] - data[c + 2]) > 24) {
          blended++;
          break;
        }
      }
    }
  }
  state.gridNote = blended === 0 ? 'ART SITS EXACTLY ON THE 120 GRID' : `${blended} CELLS BLEND (ART USES A FINER GRID)`;
}

async function loadToken(collection, tokenId) {
  setStatus('LOADING ART FROM ROBINHOOD CHAIN…');
  let art;
  try {
    art = await loadTokenArt(collection, tokenId);
  } catch (error) {
    if (error.code === 'not_found') {
      toast(`${displayName(collection, tokenId)} IS NOT MINTED YET`);
      setStatus();
      return false;
    }
    if (collection.id === 'stonkbrokers' && tokenId === DEFAULT_TOKEN_ID) {
      art = await artFromUrl('assets/demo/stonkbrokers-4354.png');
    } else {
      toast("COULDN'T REACH THE CHAIN. TRY AGAIN.");
      setStatus();
      return false;
    }
  }
  snapshot();
  state.collection = collection;
  state.tokenId = tokenId;
  rasterise(art);
  template = await loadCardTemplate(tokenId);
  drawLabels();
  changed();
  return true;
}

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const collection = COLLECTIONS[els.collection.value];
  const id = Number(els.tokenId.value);
  if (!Number.isInteger(id) || id < collection.minId || id > collection.maxId) {
    toast(`${collection.menuLabel} RUN FROM #${collection.minId} TO #${collection.maxId}`);
    return;
  }
  loadToken(collection, id);
});

// --------------------------------------------------------------- preview
let scene;
let labelArtwork;
const cardCanvas = document.createElement('canvas');
const labelFront = document.createElement('canvas');
const labelBack = document.createElement('canvas');
let composing = false;
let composeAgain = false;
let liveTimer;

async function composePreview() {
  if (!scene) return;
  if (composing) {
    composeAgain = true;
    return;
  }
  composing = true;
  try {
    const i = cellIndex(0, 0);
    await composeCardFront(cardCanvas, {
      image: artCanvas, width: N, height: N, pixelated: true,
      background: toHex(pixels[i], pixels[i + 1], pixels[i + 2]),
    }, state.tokenId);
    scene.setMaterialImage('Card_Front', cardCanvas);
  } finally {
    composing = false;
    if (composeAgain) {
      composeAgain = false;
      composePreview();
    }
  }
}

function drawLabels() {
  if (!scene || !labelArtwork) return;
  drawLabelFront(labelFront, labelArtwork, { line2: state.collection.labelName, cardNo: `#${state.tokenId}` });
  scene.setMaterialImage('Label_Front', labelFront);
}

/** After any edit: grid, palette, preview (throttled while drawing), autosave. */
function changed({ live = false } = {}) {
  syncArtCanvas();
  render();
  setStatus();
  if (live) {
    if (!liveTimer) liveTimer = setTimeout(() => { liveTimer = null; composePreview(); }, 120);
  } else {
    clearTimeout(liveTimer);
    liveTimer = null;
    composePreview();
    refreshPalette();
    autosave();
  }
  els.collection.value = state.collection.id;
  els.tokenId.value = String(state.tokenId);
}

function face(angle) {
  scene.autoRotate = false;
  els.spin.classList.remove('on');
  els.spin.setAttribute('aria-pressed', 'false');
  scene.turntable.rotation.y = angle;
  scene.frameCamera(true);
}
els.front.addEventListener('click', () => face(0));
els.back.addEventListener('click', () => face(Math.PI));
els.spin.addEventListener('click', () => {
  scene.autoRotate = !scene.autoRotate;
  els.spin.classList.toggle('on', scene.autoRotate);
  els.spin.setAttribute('aria-pressed', String(scene.autoRotate));
});

// ---------------------------------------------------------------- export
function baseName() {
  return `${state.collection.titleName.toLowerCase()}-${state.tokenId}-edit`;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`SAVED ${name.toUpperCase()}`);
}
els.png.addEventListener('click', () => artCanvas.toBlob((b) => download(b, `${baseName()}-120.png`), 'image/png'));
els.pngLarge.addEventListener('click', () => {
  const big = Object.assign(document.createElement('canvas'), { width: N * 10, height: N * 10 });
  const ctx = big.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(artCanvas, 0, 0, big.width, big.height);
  big.toBlob((b) => download(b, `${baseName()}-1200.png`), 'image/png');
});
els.svg.addEventListener('click', () => {
  const rects = [];
  for (let y = 0; y < N; y++) {
    let x = 0;
    while (x < N) {
      const colour = cellHex(x, y);
      let run = 1;
      while (x + run < N && cellHex(x + run, y) === colour) run++;
      rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${colour}"/>`);
      x += run;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="${N * 10}" height="${N * 10}" shape-rendering="crispEdges">\n${rects.join('\n')}\n</svg>\n`;
  download(new Blob([svg], { type: 'image/svg+xml' }), `${baseName()}.svg`);
});

// ------------------------------------------------------------------ boot
async function boot() {
  updateHistoryButtons();
  new ResizeObserver(() => fitZoom()).observe(els.wrap);
  scene = new SlabScene(els.stage);
  scene.autoRotate = false;
  const [, back, artwork] = await Promise.all([
    scene.load('assets/slab.glb'),
    loadCardBack(),
    loadLabelArtwork(),
    loadCardFonts(),
    loadLabelFont(),
  ]);
  labelArtwork = artwork;
  scene.setMaterialImage('Card_Back', back);
  drawLabelBack(labelBack, labelArtwork);
  scene.setMaterialImage('Label_Back', labelBack);
  scene.start();

  if (restoreSaved()) {
    template = await loadCardTemplate(state.tokenId);
    state.gridNote = 'RESTORED YOUR LAST EDIT';
    state.undo.length = 0;
    drawLabels();
    changed();
    toast('RESTORED YOUR LAST EDIT. PRESS LOAD FOR THE ORIGINAL.', 3600);
  } else {
    await loadToken(state.collection, state.tokenId);
    state.undo.length = 0;
    updateHistoryButtons();
  }
  setColour(state.colour);
}

boot().catch((error) => {
  console.error('[pixel-studio] boot failed', error);
  setStatus('SOMETHING WENT WRONG. PLEASE REFRESH.');
});
