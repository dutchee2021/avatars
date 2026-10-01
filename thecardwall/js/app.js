import {
  COLLECTIONS, DEFAULT_COLLECTION, DEFAULT_TOKEN_ID, LABEL, SITE_NAME,
  CANONICAL_URL, PREVIEW, openseaUrl, displayName,
} from './config.js';
import { SlabScene } from './scene.js';
import { loadTokenArt, artFromUrl, placeholderArt } from './token-art.js';
import { composeCardFront, loadCardBack, loadCardFonts, loadCardTemplate } from './card.js';
import { drawLabelFront, drawLabelBack, LABEL_SIZE, LABEL_FONT } from './label.js';
import { exportTurntable, EXPORT_SPEC } from './export-mp4.js';
import {
  arPlatform, androidArSupported, prepareQuickLook, launchQuickLook, prepareAndroidAr, launchAndroidAr, drawQr,
} from './ar.js';

const $ = (id) => document.getElementById(id);
const els = {
  stage: $('stage'),
  title: $('tokenTitle'),
  cart: $('cartBtn'),
  tokenBar: $('tokenBar'),
  tokenInput: $('tokenInput'),
  download: $('downloadBtn'),
  random: $('randomBtn'),
  ar: $('arBtn'),
  collectionLabel: $('collectionLabel'),
  collectionChevron: $('collectionChevron'),
  collectionMenu: $('collectionMenu'),
  loader: $('tokenLoader'),
  toast: $('toast'),
  progress: $('progressWrap'),
  progressFill: $('progressFill'),
  progressLabel: $('progressLabel'),
  saveDialog: $('saveDialog'),
  saveTitle: $('saveTitle'),
  saveLink: $('saveLink'),
  saveCopy: $('saveCopy'),
  saveStatus: $('saveStatus'),
  savePost: $('savePost'),
  saveDownload: $('saveDownload'),
  saveDownloadLabel: $('saveDownloadLabel'),
  qrDialog: $('qrDialog'),
  qrTitle: $('qrTitle'),
  qrCanvas: $('qrCanvas'),
  qrLink: $('qrLink'),
  qrCopy: $('qrCopy'),
};

const platform = arPlatform();
const isTouch = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
// Inside a claude.ai artifact, files are saved through the viewer's
// "downloads" capability; everywhere else window.claude does not exist.
let hostDownloads = null;
window.claude?.use?.('downloads').then((ns) => { hostDownloads = ns; }, () => {});
const state = {
  collection: COLLECTIONS[DEFAULT_COLLECTION],
  tokenId: DEFAULT_TOKEN_ID,
  seq: 0,
  job: null, // MP4 preparation for the current selection
};
const cardCanvas = document.createElement('canvas');
const labelFront = Object.assign(document.createElement('canvas'), LABEL_SIZE);
const labelBack = Object.assign(document.createElement('canvas'), LABEL_SIZE);
let scene;

const selectionKey = () => `${state.collection.id}-${state.tokenId}`;
const currentName = () => displayName(state.collection, state.tokenId);

// ------------------------------------------------------------------ helpers
function showToast(message, ms = 2600) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), ms);
}

function setProgress(value, label) {
  els.progressFill.style.width = `${Math.round(value * 100)}%`;
  if (label) els.progressLabel.textContent = label;
}

function hideProgress() {
  els.progress.classList.add('hidden');
  setTimeout(() => els.progress.remove(), 450);
}

function parseTokenId(raw, collection) {
  if (raw == null || String(raw).trim() === '') return null;
  const text = String(raw).trim().replace(/^#/, '');
  if (!/^\d{1,6}$/.test(text)) return null;
  const id = Number(text);
  return id >= collection.minId && id <= collection.maxId ? id : null;
}

function shareBase() {
  try {
    const url = new URL(window.location.href);
    const sandboxed = /claudeusercontent|claude\.ai|^$/.test(url.hostname);
    if (!/^https?:$/.test(url.protocol) || sandboxed) throw new Error('not shareable');
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return new URL(CANONICAL_URL);
  }
}

const selectionHash = (ar) => `${state.collection.id}-${state.tokenId}${ar ? '-ar' : ''}`;

function shareUrl({ ar = false } = {}) {
  // The review build cannot read query strings, only a plain #anchor.
  if (PREVIEW) return `${CANONICAL_URL}#${selectionHash(ar)}`;
  const url = shareBase();
  url.searchParams.set('collection', state.collection.id);
  url.searchParams.set('token', String(state.tokenId));
  if (ar) url.searchParams.set('ar', '1');
  return url.href;
}

function writeUrl() {
  if (PREVIEW) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('collection', state.collection.id);
    url.searchParams.set('token', String(state.tokenId));
    url.searchParams.delete('ar');
    window.history.replaceState(null, '', url);
  } catch {
    // sandboxed preview frames may refuse history updates
  }
}

function readUrl() {
  // ?collection=interns&token=123&ar=1, or the short form #interns-123-ar
  const params = new URLSearchParams(window.location.search);
  const hash = /^#?([a-z]+)-(\d{1,6})(-ar)?$/i.exec(window.location.hash || '');
  const collection = COLLECTIONS[(params.get('collection') || params.get('c') || hash?.[1] || '').toLowerCase()]
    || COLLECTIONS[DEFAULT_COLLECTION];
  const tokenId = parseTokenId(params.get('token') ?? params.get('id') ?? params.get('tokenId') ?? hash?.[2], collection)
    ?? DEFAULT_TOKEN_ID;
  return { collection, tokenId, ar: params.get('ar') === '1' || Boolean(hash?.[3]) };
}

// --------------------------------------------------------------- identity
function renderIdentity() {
  const name = currentName();
  els.title.textContent = name;
  document.title = `${SITE_NAME} | ${name}`;
  els.cart.href = openseaUrl(state.collection, state.tokenId);
  els.cart.setAttribute('aria-label', `Buy ${name} on OpenSea`);
  els.tokenInput.value = String(state.tokenId);
  els.tokenInput.min = String(state.collection.minId);
  els.tokenInput.max = String(state.collection.maxId);
  els.collectionLabel.textContent = state.collection.menuLabel;
  for (const option of els.collectionMenu.querySelectorAll('[data-collection]')) {
    option.setAttribute('aria-selected', String(option.dataset.collection === state.collection.id));
  }
  els.saveTitle.textContent = name;
  els.qrTitle.textContent = name;
}

function drawLabels() {
  drawLabelFront(labelFront, {
    ...LABEL,
    line2: state.collection.labelName,
    cardNo: `#${state.tokenId}`,
  });
  scene.setMaterialImage('Label_Front', labelFront);
}

async function fallbackArt(collection, tokenId) {
  if (collection.id === 'stonkbrokers' && tokenId === DEFAULT_TOKEN_ID) {
    try {
      return await artFromUrl('assets/demo/stonkbrokers-4354.png');
    } catch {
      // fall through to the neutral placeholder
    }
  }
  return placeholderArt();
}

function setLoading(on) {
  els.loader.hidden = !on;
}

/**
 * Load one token into the slab. Resolves 'ok', 'not_found' (selection is
 * restored to the previous token) or 'stale' (a newer selection won).
 */
async function selectToken(collection, tokenId, { quiet = false } = {}) {
  const previous = { collection: state.collection, tokenId: state.tokenId };
  const changed = previous.collection !== collection || previous.tokenId !== tokenId;
  state.collection = collection;
  state.tokenId = tokenId;
  const seq = ++state.seq;
  renderIdentity();
  drawLabels();
  writeUrl();
  if (changed) cancelJob();
  setLoading(true);

  let art;
  let live = true;
  try {
    art = await loadTokenArt(collection, tokenId);
  } catch (error) {
    if (seq !== state.seq) return 'stale';
    if (error.code === 'not_found') {
      setLoading(false);
      state.collection = previous.collection;
      state.tokenId = previous.tokenId;
      renderIdentity();
      drawLabels();
      writeUrl();
      if (!quiet) showToast(`${displayName(collection, tokenId)} IS NOT MINTED YET`);
      return 'not_found';
    }
    console.warn('[cardwall] live art unavailable:', error.message);
    art = await fallbackArt(collection, tokenId);
    live = false;
  }
  if (seq !== state.seq) return 'stale';
  await composeCardFront(cardCanvas, art, tokenId);
  if (seq !== state.seq) return 'stale';
  scene.setMaterialImage('Card_Front', cardCanvas);
  setLoading(false);
  if (!live && PREVIEW) {
    if (!selectToken.notedPreview) showToast('PREVIEW SHOWS PLACEHOLDER ART. LIVE ART LOADS ON THE SITE.', 4200);
    selectToken.notedPreview = true;
  } else if (!live && !quiet) {
    showToast('LIVE ART IS UNAVAILABLE RIGHT NOW');
  }
  scheduleArPrewarm();
  return 'ok';
}

// ------------------------------------------------------------ token input
let skipBlurCommit = false;
function commitInput() {
  const raw = els.tokenInput.value;
  if (raw.trim() === '' || Number(raw) === state.tokenId) {
    els.tokenInput.value = String(state.tokenId);
    return;
  }
  const id = parseTokenId(raw, state.collection);
  if (id == null) {
    const c = state.collection;
    showToast(`${c.menuLabel} RUN FROM #${c.minId} TO #${c.maxId}`);
    els.tokenInput.value = String(state.tokenId);
    return;
  }
  selectToken(state.collection, id);
}

els.tokenBar.addEventListener('submit', (event) => {
  event.preventDefault();
  skipBlurCommit = true;
  commitInput();
  els.tokenInput.blur();
  setTimeout(() => { skipBlurCommit = false; }, 0);
});
els.tokenInput.addEventListener('blur', () => {
  if (!skipBlurCommit) commitInput();
});
els.tokenInput.addEventListener('focus', () => els.tokenInput.select());
// A tap on another control wins over committing a half-typed number.
for (const control of [els.download, els.random, els.ar, els.collectionLabel, els.collectionChevron]) {
  control.addEventListener('pointerdown', () => {
    if (document.activeElement === els.tokenInput) {
      skipBlurCommit = true;
      els.tokenInput.value = String(state.tokenId);
      setTimeout(() => { skipBlurCommit = false; }, 400);
    }
  });
}

els.random.addEventListener('click', async () => {
  const c = state.collection;
  for (let attempt = 0; attempt < 6; attempt++) {
    let id;
    do {
      id = c.minId + Math.floor(Math.random() * (c.maxId - c.minId + 1));
    } while (id === state.tokenId && c.maxId > c.minId);
    const result = await selectToken(c, id, { quiet: true });
    if (result === 'ok' || result === 'stale') return;
  }
  showToast('NO MINTED TOKEN FOUND. TRY AGAIN.');
});

// ----------------------------------------------------- collection picker
function setMenu(open) {
  els.collectionMenu.hidden = !open;
  els.collectionLabel.setAttribute('aria-expanded', String(open));
  els.collectionChevron.setAttribute('aria-expanded', String(open));
  if (open) {
    els.collectionMenu.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
  }
}
const toggleMenu = () => setMenu(els.collectionMenu.hidden);
els.collectionLabel.addEventListener('click', toggleMenu);
els.collectionChevron.addEventListener('click', toggleMenu);
els.collectionMenu.addEventListener('click', (event) => {
  const option = event.target.closest('[data-collection]');
  if (!option) return;
  setMenu(false);
  els.collectionLabel.focus({ preventScroll: true });
  const collection = COLLECTIONS[option.dataset.collection];
  if (!collection || collection === state.collection) return;
  const keep = parseTokenId(state.tokenId, collection);
  selectToken(collection, keep ?? DEFAULT_TOKEN_ID);
});
els.collectionMenu.addEventListener('keydown', (event) => {
  const options = [...els.collectionMenu.querySelectorAll('[data-collection]')];
  const index = options.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next].focus();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (!els.collectionMenu.hidden && !event.target.closest('.collection-bar')) setMenu(false);
});

// ------------------------------------------------------------- dialogs
let openDialog = null;
function showDialog(dialog) {
  if (openDialog && openDialog !== dialog) openDialog.hidden = true;
  openDialog = dialog;
  dialog.hidden = false;
  document.body.classList.add('dialog-open');
  scene?.hold(true); // the dialog covers the stage; give the GPU to the export
  dialog.querySelector('[data-close]')?.focus({ preventScroll: true });
}
function closeDialog(dialog = openDialog) {
  if (!dialog) return;
  dialog.hidden = true;
  document.body.classList.remove('dialog-open');
  openDialog = null;
  scene?.hold(false);
}
for (const dialog of [els.saveDialog, els.qrDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.closest('[data-close]')) closeDialog(dialog);
  });
}
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (openDialog) closeDialog();
  else if (!els.collectionMenu.hidden) setMenu(false);
});

async function copyField(input, button) {
  const text = input.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    input.focus();
    input.select();
  }
  button.dataset.copied = 'true';
  setTimeout(() => { button.dataset.copied = 'false'; }, 1600);
}
els.saveCopy.addEventListener('click', () => copyField(els.saveLink, els.saveCopy).then(() => setSaveStatus('LINK COPIED', 'done')));
els.qrCopy.addEventListener('click', () => copyField(els.qrLink, els.qrCopy));

// ---------------------------------------------------------- MP4 save flow
const formatSize = (bytes) => (bytes >= 1e5 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);
const videoSummary = (file) => `${formatSize(file.size)}  •  ${EXPORT_SPEC.size}x${EXPORT_SPEC.size}  •  6 SEC LOOP`;

function setSaveStatus(message = '', kind = '') {
  els.saveStatus.textContent = message;
  els.saveStatus.hidden = !message;
  els.saveStatus.className = `save-status${kind ? ` state-${kind}` : ''}`;
}

function renderSaveButton() {
  const job = state.job;
  const button = els.saveDownload;
  button.classList.remove('is-ready');
  if (!job || job.status === 'error') {
    button.disabled = false;
    els.saveDownloadLabel.textContent = job ? 'TRY AGAIN' : 'DOWNLOAD VIDEO';
    return;
  }
  if (job.status === 'preparing') {
    button.disabled = true;
    els.saveDownloadLabel.textContent = `LOADING ${Math.min(99, Math.floor(job.progress * 100))}%`;
    return;
  }
  button.disabled = false;
  button.classList.add('is-ready');
  els.saveDownloadLabel.textContent = job.saved ? 'DOWNLOAD AGAIN' : 'DOWNLOAD VIDEO';
}

function cancelJob() {
  if (state.job?.status === 'preparing') state.job.abort.abort();
  state.job = null;
  if (!els.saveDialog.hidden) {
    setSaveStatus();
    renderSaveButton();
  }
}

function prepareVideo() {
  const key = selectionKey();
  if (state.job && state.job.key === key && state.job.status !== 'error') return state.job;
  const job = { key, status: 'preparing', progress: 0, file: null, saved: false, abort: new AbortController() };
  state.job = job;
  const filename = `thecardwall-${state.collection.titleName.toLowerCase()}-${state.tokenId}-${EXPORT_SPEC.size}.mp4`;
  renderSaveButton();
  exportTurntable(scene, {
    signal: job.abort.signal,
    onProgress: (p) => {
      job.progress = p;
      if (state.job === job && !els.saveDialog.hidden) renderSaveButton();
    },
  }).then((blob) => {
    const type = blob.type || 'video/mp4';
    const name = type.includes('webm') ? filename.replace(/\.mp4$/, '.webm') : filename;
    job.file = new File([blob], name, { type });
    job.status = 'ready';
    if (state.job === job) {
      renderSaveButton();
      setSaveStatus(videoSummary(job.file));
    }
  }).catch((error) => {
    if (error.code === 'aborted') return;
    console.error('[cardwall] export failed', error);
    job.status = 'error';
    if (state.job === job) {
      renderSaveButton();
      setSaveStatus(error.code === 'unsupported'
        ? 'This browser cannot create videos. Try the latest Chrome or Safari.'
        : 'The video could not be created. Please try again.', 'error');
    }
  });
  return job;
}

function openSaveDialog() {
  els.saveTitle.textContent = currentName();
  els.saveLink.value = shareUrl();
  const text = `${currentName()} on ${SITE_NAME}`;
  els.savePost.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl())}`;
  setSaveStatus();
  showDialog(els.saveDialog);
  prepareVideo();
  renderSaveButton();
  if (state.job?.status === 'ready') {
    setSaveStatus(videoSummary(state.job.file));
  }
}

async function saveWithHost(job) {
  try {
    await hostDownloads.save({ filename: job.file.name, data: job.file });
    job.saved = true;
    renderSaveButton();
    setSaveStatus('MP4 SAVED', 'done');
  } catch (error) {
    if (error?.code === 'declined') return;
    setSaveStatus(error?.code === 'rate_limited'
      ? 'A save prompt is already open.'
      : 'Saving is not available here.', 'error');
  }
}

function saveFile(job) {
  const file = job.file;
  if (hostDownloads) {
    saveWithHost(job);
    return;
  }
  const canShareFile = (() => {
    try {
      return typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true;
    } catch {
      return false;
    }
  })();
  if (isTouch && canShareFile) {
    // Inside the fresh tap, as iOS and Android require for the share sheet.
    navigator.share({ files: [file], title: currentName() })
      .then(() => {
        job.saved = true;
        renderSaveButton();
        setSaveStatus('MP4 READY IN SHARE / SAVE', 'done');
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setSaveStatus('Saving was blocked. Tap Download Video again.', 'error');
      });
    return;
  }
  const url = URL.createObjectURL(file);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  job.saved = true;
  renderSaveButton();
  setSaveStatus('MP4 SENT TO DOWNLOADS', 'done');
}

els.download.addEventListener('click', openSaveDialog);
els.saveDownload.addEventListener('click', () => {
  const job = state.job;
  if (job?.status === 'ready') saveFile(job);
  else if (!job || job.status === 'error') {
    state.job = null;
    prepareVideo();
    setSaveStatus();
  }
});

// -------------------------------------------------------------------- AR
let prewarmTimer;
function scheduleArPrewarm() {
  clearTimeout(prewarmTimer);
  if (platform.kind === 'desktop' || PREVIEW) return;
  prewarmTimer = setTimeout(() => {
    const key = selectionKey();
    const run = async () => {
      if (key !== selectionKey()) return;
      if (platform.kind === 'ios' && platform.quickLook) prepareQuickLook(scene, key).catch(() => {});
      if (platform.kind === 'android' && await androidArSupported()) prepareAndroidAr(scene, key).catch(() => {});
    };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2500 });
    else run();
  }, 1200);
}

function setArBusy(busy) {
  els.ar.classList.toggle('is-busy', busy);
  els.ar.disabled = busy;
}

async function openQrDialog() {
  const link = shareUrl({ ar: true });
  els.qrLink.value = link;
  showDialog(els.qrDialog);
  try {
    await drawQr(els.qrCanvas, link);
  } catch (error) {
    console.error('[cardwall] QR failed', error);
    showToast('QR CODE UNAVAILABLE. COPY THE LINK INSTEAD.');
  }
}

// AR must launch inside the tap (user activation). If the model was not
// ready yet (tapped right after a token change), building it can outlast the
// activation window, so the slab is prepared and the user taps once more.
const AR_LAUNCH_WINDOW_MS = { ios: 900, android: 3500 };
function arReadyAgain() {
  els.ar.classList.add('nudge');
  showToast('AR IS READY. TAP AR AGAIN.');
}

els.ar.addEventListener('click', async () => {
  els.ar.classList.remove('nudge');
  if (platform.kind === 'desktop') {
    openQrDialog();
    return;
  }
  if (PREVIEW) {
    showToast('AR OPENS ON THE LIVE SITE, NOT IN THIS PREVIEW.', 3600);
    return;
  }
  if (platform.kind === 'ios' && !platform.quickLook) {
    showToast('OPEN THIS PAGE IN SAFARI TO VIEW IN AR');
    return;
  }
  if (platform.kind === 'android' && !(await androidArSupported())) {
    showToast('AR NEEDS CHROME ON AN ARCORE PHONE');
    return;
  }
  const key = selectionKey();
  const started = performance.now();
  const late = () => performance.now() - started > AR_LAUNCH_WINDOW_MS[platform.kind];
  setArBusy(true);
  try {
    if (platform.kind === 'ios') {
      const url = await prepareQuickLook(scene, key);
      if (late()) arReadyAgain();
      else launchQuickLook(url);
    } else {
      const viewer = await prepareAndroidAr(scene, key);
      if (late()) arReadyAgain();
      else if (!(await launchAndroidAr(viewer))) showToast('AR NEEDS CHROME ON AN ARCORE PHONE');
    }
  } catch (error) {
    console.error('[cardwall] AR failed', error);
    showToast('AR COULD NOT START. PLEASE TRY AGAIN.');
  } finally {
    setArBusy(false);
  }
});

// ----------------------------------------------------------------- layout
function layout() {
  if (!scene) return;
  const title = document.querySelector('.plate-id').getBoundingClientRect();
  const bar = els.tokenBar.getBoundingClientRect();
  scene.setInsets(title.bottom + 10, window.innerHeight - bar.top + 10);
}

// ------------------------------------------------------------------ boot
async function boot() {
  const initial = readUrl();
  state.collection = initial.collection;
  state.tokenId = initial.tokenId;
  renderIdentity();
  setProgress(0.06, 'LOADING');
  try {
    scene = new SlabScene(els.stage);
  } catch (error) {
    console.error(error);
    setProgress(0, 'THIS DEVICE CANNOT SHOW 3D');
    return;
  }
  window.addEventListener('resize', layout);
  layout();

  const fonts = Promise.allSettled([
    loadCardFonts(),
    document.fonts.load(`400 40px ${LABEL_FONT}`, 'A#0'),
    document.fonts.load(`700 40px ${LABEL_FONT}`, 'A#0'),
    document.fonts.load('600 17px "Space Grotesk"'),
  ]);
  const [back] = await Promise.all([
    loadCardBack(),
    scene.load('assets/slab.glb').then(() => setProgress(0.55, 'LOADING SLAB')),
    loadCardTemplate(),
    fonts,
  ]);
  layout();
  scene.setMaterialImage('Card_Back', back);
  drawLabelBack(labelBack, LABEL);
  scene.setMaterialImage('Label_Back', labelBack);
  setProgress(0.75, 'LOADING CARD');

  // Never hold the launch screen for a slow chain read: the art lands when ready.
  const first = selectToken(state.collection, state.tokenId);
  await Promise.race([first, new Promise((resolve) => setTimeout(resolve, 7000))]);
  setProgress(1);
  scene.start();
  hideProgress();
  if (initial.ar && platform.kind !== 'desktop') {
    els.ar.classList.add('nudge');
    showToast('TAP AR TO PLACE YOUR SLAB', 4200);
  }
}

boot().catch((error) => {
  console.error('[cardwall] boot failed', error);
  setProgress(0, 'SOMETHING WENT WRONG. PLEASE REFRESH.');
});
