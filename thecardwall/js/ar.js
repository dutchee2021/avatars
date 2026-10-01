// AR handoff. The slab lies flat (face up) on the detected horizontal plane.
//   iOS / iPadOS: USDZ generated on the device -> AR Quick Look (ARKit)
//   Android:      WebXR immersive-ar in Chrome (ARCore) through <model-viewer>
//   Desktop:      QR code that opens the same collection/token on a phone

export function arPlatform() {
  const ua = navigator.userAgent || '';
  // Mac Safari also supports rel="ar" (a 3D preview, not AR), so it counts
  // as desktop and gets the QR handoff like every other computer.
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) return { kind: 'ios', quickLook: document.createElement('a').relList?.supports?.('ar') === true };
  if (/Android/i.test(ua)) return { kind: 'android' };
  return { kind: 'desktop' };
}

let xrSupport;
/** Whether this Android browser can start a WebXR AR session (ARCore). */
export function androidArSupported() {
  xrSupport ??= (async () => {
    try {
      return (await navigator.xr?.isSessionSupported?.('immersive-ar')) === true;
    } catch {
      return false;
    }
  })();
  return xrSupport;
}

// ------------------------------------------------------------------ iOS
let usdzCache = { key: null, promise: null, url: null };

export function prepareQuickLook(scene, key) {
  if (usdzCache.key === key && usdzCache.promise) return usdzCache.promise;
  if (usdzCache.url) URL.revokeObjectURL(usdzCache.url);
  const promise = (async () => {
    const { USDZExporter } = await import('../vendor/three/addons/exporters/USDZExporter.js');
    const model = scene.buildArModel();
    const data = await new USDZExporter().parseAsync(model, {
      quickLookCompatible: true,
      maxTextureSize: 2048,
      ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
    });
    const url = URL.createObjectURL(new Blob([data], { type: 'model/vnd.usdz+zip' }));
    if (usdzCache.key === key) usdzCache.url = url;
    return url;
  })();
  usdzCache = { key, promise, url: null };
  promise.catch(() => {
    if (usdzCache.promise === promise) usdzCache = { key: null, promise: null, url: null };
  });
  return promise;
}

/** Hand the prepared USDZ to AR Quick Look (must run inside the tap). */
export function launchQuickLook(url) {
  const anchor = document.createElement('a');
  anchor.setAttribute('rel', 'ar');
  anchor.href = url;
  // A generated (blob:) USDZ needs a download name, as <model-viewer> does.
  anchor.setAttribute('download', 'thecardwall-slab.usdz');
  anchor.style.display = 'none';
  anchor.append(document.createElement('img')); // Quick Look requires an <img> child
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

// --------------------------------------------------------------- Android
let viewerPromise;
let androidCache = { key: null, promise: null, url: null };

function modelViewerElement() {
  let element = document.getElementById('cwArViewer');
  if (!element) {
    element = document.createElement('model-viewer');
    element.id = 'cwArViewer';
    element.setAttribute('ar', '');
    element.setAttribute('ar-modes', 'webxr');
    element.setAttribute('ar-placement', 'floor');
    element.setAttribute('loading', 'eager');
    element.setAttribute('shadow-intensity', '1');
    element.setAttribute('environment-image', 'neutral');
    element.setAttribute('aria-hidden', 'true');
    element.className = 'ar-host';
    // The default AR button is replaced by the page's own AR control.
    const slot = document.createElement('span');
    slot.slot = 'ar-button';
    slot.hidden = true;
    element.append(slot);
    document.body.append(element);
  }
  return element;
}

export function prepareAndroidAr(scene, key) {
  if (androidCache.key === key && androidCache.promise) return androidCache.promise;
  const previousUrl = androidCache.url;
  const promise = (async () => {
    viewerPromise ??= import('../vendor/model-viewer/model-viewer-4.2.0.min.js').then(() => customElements.whenDefined('model-viewer'));
    const [{ GLTFExporter }] = await Promise.all([
      import('../vendor/three/addons/exporters/GLTFExporter.js'),
      viewerPromise,
    ]);
    const glb = await new GLTFExporter().parseAsync(scene.buildArModel(), { binary: true, maxTextureSize: 2048 });
    const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    const element = modelViewerElement();
    const loaded = new Promise((resolve, reject) => {
      element.addEventListener('load', resolve, { once: true });
      element.addEventListener('error', () => reject(new Error('AR model failed to load')), { once: true });
    });
    element.src = url;
    await loaded;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    androidCache.url = url;
    return element;
  })();
  androidCache = { key, promise, url: null };
  promise.catch(() => {
    if (androidCache.promise === promise) androidCache = { key: null, promise: null, url: null };
  });
  return promise;
}

/** Enter WebXR AR with a prepared viewer. Returns false when unsupported. */
export async function launchAndroidAr(element) {
  // canActivateAR resolves asynchronously after the src is set.
  for (let i = 0; i < 20 && !element.canActivateAR; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!element.canActivateAR) return false;
  await element.activateAR();
  return true;
}

// --------------------------------------------------------------- desktop
let qrLibrary;
function loadQrLibrary() {
  qrLibrary ??= new Promise((resolve, reject) => {
    if (window.QRCode) return resolve(window.QRCode);
    const script = document.createElement('script');
    script.src = 'vendor/qrcode/qrcode-1.5.1.js';
    script.onload = () => (window.QRCode ? resolve(window.QRCode) : reject(new Error('QR library missing')));
    script.onerror = () => {
      qrLibrary = null;
      reject(new Error('QR library failed to load'));
    };
    document.head.append(script);
  });
  return qrLibrary;
}

export async function drawQr(canvas, text) {
  const QRCode = await loadQrLibrary();
  await QRCode.toCanvas(canvas, text, {
    width: canvas.width,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#08090b', light: '#f4f5f0' },
  });
}
