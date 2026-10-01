import { drawLabelFront, drawLabelBack, LABEL_DEFAULTS, LABEL_SIZE } from './label.js';

// Material names baked into slab.glb by build_slab.py.
const MATERIALS = {
  cardFront: 'Card_Front',
  cardBack: 'Card_Back',
  labelFront: 'Label_Front',
  labelBack: 'Label_Back',
};
const CLEAR_MATERIALS = ['Slab_Clear', 'Slab_Edge'];
const CARD_SIZE = { width: 1000, height: 1400 }; // 2.5 x 3.5 in

await customElements.whenDefined('model-viewer');
const viewer = document.getElementById('viewer');
const form = document.getElementById('label-form');
const preview = document.getElementById('label-preview');
const toastEl = document.getElementById('toast');

const state = {
  fit: 'cover',
  labelMode: 'template',
  label: { ...LABEL_DEFAULTS },
  images: {}, // target -> HTMLImageElement, kept so a new fit can be re-applied
};

const modelReady = new Promise((resolve) => {
  if (viewer.loaded) resolve();
  else viewer.addEventListener('load', () => resolve(), { once: true });
});

// ------------------------------------------------------------------ helpers
let toastTimer;
function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('error', isError);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, isError ? 6000 : 2500);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image: ${src}`));
    img.src = src;
  });
}

function makeCanvas({ width, height }) {
  return Object.assign(document.createElement('canvas'), { width, height });
}

/** Draw an image into a canvas of the target size using cover / contain / stretch. */
function fitImage(img, size, fit) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f1ede3';
  ctx.fillRect(0, 0, size.width, size.height);
  if (fit === 'stretch') {
    ctx.drawImage(img, 0, 0, size.width, size.height);
  } else {
    const pick = fit === 'cover' ? Math.max : Math.min;
    const s = pick(size.width / img.naturalWidth, size.height / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.drawImage(img, (size.width - w) / 2, (size.height - h) / 2, w, h);
  }
  return canvas;
}

const objectUrls = new Map();
const latest = {};
async function setMaterialImage(target, canvas, type = 'image/jpeg') {
  const seq = (latest[target] = (latest[target] ?? 0) + 1);
  await modelReady;
  const material = viewer.model.getMaterialByName(MATERIALS[target]);
  if (!material) throw new Error(`Material "${MATERIALS[target]}" not found in the model`);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.95));
  const url = URL.createObjectURL(blob);
  const texture = await viewer.createTexture(url, type);
  if (seq !== latest[target]) { // a newer image arrived while this one was loading
    URL.revokeObjectURL(url);
    return;
  }
  material.pbrMetallicRoughness.baseColorTexture.setTexture(texture);
  if (objectUrls.has(target)) URL.revokeObjectURL(objectUrls.get(target));
  objectUrls.set(target, url);
}

function save(blob, filename) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ------------------------------------------------------------- card + label
const isCard = (target) => target === 'cardFront' || target === 'cardBack';

async function applyImage(target) {
  const img = state.images[target];
  if (!img) return;
  const canvas = fitImage(img, isCard(target) ? CARD_SIZE : LABEL_SIZE, state.fit);
  if (target === 'labelFront') drawPreview(canvas);
  await setMaterialImage(target, canvas);
}

async function useImage(target, src, name) {
  try {
    state.images[target] = await loadImage(src);
    if (isCard(target)) await applyImage(target);
    else await setLabelMode('image');
    const input = document.querySelector(`input[data-target="${target}"]`);
    if (input && name) input.parentElement.querySelector('span').textContent = name;
  } catch (err) {
    toast(err.message, true);
  }
}

function drawPreview(source) {
  const ctx = preview.getContext('2d');
  ctx.clearRect(0, 0, preview.width, preview.height);
  ctx.drawImage(source, 0, 0, preview.width, preview.height);
}

function labelCanvases() {
  return {
    front: drawLabelFront(makeCanvas(LABEL_SIZE), state.label),
    back: drawLabelBack(makeCanvas(LABEL_SIZE), state.label),
  };
}

let labelTimer;
function renderLabelTemplate(immediate = false) {
  const { front, back } = labelCanvases();
  drawPreview(front);
  clearTimeout(labelTimer);
  const apply = async () => {
    try {
      // JPEG: encodes far faster than PNG while typing, and keeps exported GLBs small
      await Promise.all([setMaterialImage('labelFront', front), setMaterialImage('labelBack', back)]);
    } catch (err) {
      toast(err.message, true);
    }
  };
  if (immediate) return apply();
  labelTimer = setTimeout(apply, 200);
}

async function setLabelMode(mode) {
  state.labelMode = mode;
  document.querySelectorAll('#label-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  form.hidden = mode !== 'template';
  document.getElementById('label-images').hidden = mode !== 'image';
  if (mode === 'template') return renderLabelTemplate(true);
  await Promise.all([applyImage('labelFront'), applyImage('labelBack')]);
}

// --------------------------------------------------------- iOS Quick Look
// Quick Look can't render glass transmission, so the clear case would turn
// opaque. While the USDZ is generated, swap in a translucent stand-in.
const quickLookCapable = document.createElement('a').relList?.supports?.('ar') ?? false;
function swapInQuickLookPlastic() {
  const saved = [];
  for (const name of CLEAR_MATERIALS) {
    const m = viewer.model?.getMaterialByName(name);
    if (!m) continue;
    saved.push([m, m.getAlphaMode(), [...m.pbrMetallicRoughness.baseColorFactor], m.transmissionFactor]);
    m.setTransmissionFactor(0);
    m.setAlphaMode('BLEND');
    m.pbrMetallicRoughness.setBaseColorFactor([1, 1, 1, 0.2]);
  }
  return () => {
    for (const [m, mode, color, transmission] of saved) {
      m.setAlphaMode(mode);
      m.pbrMetallicRoughness.setBaseColorFactor(color);
      m.setTransmissionFactor(transmission);
    }
  };
}
const activateAR = viewer.activateAR.bind(viewer);
viewer.activateAR = async () => {
  const restore = quickLookCapable ? swapInQuickLookPlastic() : null;
  try {
    await activateAR();
  } finally {
    restore?.();
  }
};

// ------------------------------------------------------------------- wiring
document.querySelectorAll('input[type="file"][data-target]').forEach((input) => {
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) useImage(input.dataset.target, URL.createObjectURL(file), file.name);
    input.value = '';
  });
});

document.querySelectorAll('#fit button').forEach((button) => {
  button.addEventListener('click', () => {
    state.fit = button.dataset.fit;
    document.querySelectorAll('#fit button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    for (const target of Object.keys(state.images)) {
      if (isCard(target) || state.labelMode === 'image') applyImage(target).catch((err) => toast(err.message, true));
    }
  });
});

document.querySelectorAll('#label-mode button').forEach((button) => {
  button.addEventListener('click', () => setLabelMode(button.dataset.mode).catch((err) => toast(err.message, true)));
});

form.addEventListener('input', (event) => {
  const { name, value } = event.target;
  if (name in state.label) {
    state.label[name] = value;
    renderLabelTemplate();
  }
});

document.querySelectorAll('[data-orbit]').forEach((button) => {
  button.addEventListener('click', () => {
    viewer.cameraOrbit = button.dataset.orbit;
    viewer.cameraTarget = 'auto auto auto';
    document.querySelectorAll('[data-orbit]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  });
});

document.getElementById('spin').addEventListener('change', (event) => {
  viewer.autoRotate = event.target.checked;
});

document.getElementById('download-glb').addEventListener('click', async () => {
  try {
    await modelReady;
    save(await viewer.exportScene({ binary: true }), 'slab.glb');
  } catch (err) {
    toast(`Export failed: ${err.message}`, true);
  }
});

document.getElementById('download-label').addEventListener('click', () => {
  const canvas = state.labelMode === 'image' && state.images.labelFront
    ? fitImage(state.images.labelFront, LABEL_SIZE, state.fit)
    : labelCanvases().front;
  canvas.toBlob((blob) => save(blob, 'label_front.png'), 'image/png');
});

document.getElementById('reset').addEventListener('click', () => {
  location.href = location.pathname;
});

const panel = document.getElementById('panel');
document.getElementById('panel-toggle').addEventListener('click', (event) => {
  const collapsed = panel.classList.toggle('collapsed');
  event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
});

// Drag & drop an image anywhere on the stage to replace the card front.
const stage = document.getElementById('stage');
const drop = document.getElementById('drop');
let dragDepth = 0;
stage.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; drop.hidden = false; });
stage.addEventListener('dragover', (e) => e.preventDefault());
stage.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.hidden = true; } });
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.hidden = true;
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (file) useImage('cardFront', URL.createObjectURL(file), file.name);
});

viewer.addEventListener('error', () => toast('Could not load slab.glb', true));

// ----------------------------------------------------------------- startup
// URL parameters: ?card=&back=&label=&labelBack= (image URLs) and label text:
// line1, line2, line3, cardNo, gradeText, grade, cert, logo, accent (hex, no #).
const params = new URLSearchParams(location.search);
let templateFromUrl = false;
for (const key of Object.keys(LABEL_DEFAULTS)) {
  if (params.has(key)) {
    state.label[key] = key === 'accent' ? `#${params.get(key).replace(/^#/, '')}` : params.get(key);
    templateFromUrl = true;
  }
}
for (const el of form.elements) {
  if (el.name in state.label) el.value = state.label[el.name];
}
drawPreview(labelCanvases().front);
if (templateFromUrl) renderLabelTemplate(true);

const imageParams = { card: 'cardFront', back: 'cardBack', label: 'labelFront', labelBack: 'labelBack' };
for (const [param, target] of Object.entries(imageParams)) {
  if (params.get(param)) useImage(target, params.get(param));
}
