// Card front compositor: token art + STONKCARDS frame template + the rotated
// token number on the top-left ribbon. All geometry is in the template's
// native pixels (750 x 1050 = 2.5 x 3.5 in at 300 dpi), measured from the
// supplied PNGs and the approved STONKSLAB sample. The texture is drawn at
// 8/3 of that size so pixel art and the number stay sharp up close.

export const CARD_TEXTURE = Object.freeze({ width: 2000, height: 2800 });
const TEMPLATE = Object.freeze({ width: 750, height: 1050 });
// The supplied template that already carries "#4354" (the mascot) is used
// as-is for that number, so the default card is exactly the approved file.
const TEMPLATE_NUMBER = 4354;
const SCALE = CARD_TEXTURE.width / TEMPLATE.width;

// Transparent art window inside the black frame line (alpha mask bounds).
const WINDOW = Object.freeze({ x: 37, y: 32, width: 673, height: 883 });
// Art placement: centred on the card, bottom edge on the outer edge of the
// frame's black outline, scaled to the approved sample (square art, 907.2 px
// tall; the sides fall under the frame).
const ART = Object.freeze({ centerX: 375, bottom: 920.25, height: 907.2 });

// Token number: Franklin Gothic Heavy 16 pt (66.7 px @ 300 dpi), #ff6f00,
// rotated with the ribbon and centred on the sample's ink box. If a licensed
// "Franklin Gothic Heavy" web font is added in app.css it is used as
// specified; otherwise Libre Franklin Black (OFL) is fitted to the sample
// (size, tracking, stroke and centre tuned for 87% pixel overlap).
const NUMBER_FACES = Object.freeze([
  { family: '"Franklin Gothic Heavy"', weight: 400, size: 66.7, stroke: 0, tracking: 0, cx: 153.95, cy: 123.07, angle: -35.9 },
  { family: '"Libre Franklin"', weight: 900, size: 57, stroke: 1.7, tracking: 7.4, cx: 153.41, cy: 123.93, angle: -36.5 },
]);
const NUMBER_COLOR = '#ff6f00';

const templatePromises = new Map();
let backPromise;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

/** The frame template; the "#4354" version for the mascot's number. */
export function loadCardTemplate(tokenId) {
  const url = Number(tokenId) === TEMPLATE_NUMBER ? 'assets/card-template-front-4354.png' : 'assets/card-template-front.png';
  if (!templatePromises.has(url)) templatePromises.set(url, loadImage(url));
  return templatePromises.get(url);
}

export function loadCardBack(url = 'assets/card-back.png') {
  backPromise ??= loadImage(url);
  return backPromise;
}

function numberFace() {
  for (const face of NUMBER_FACES) {
    if (document.fonts?.check?.(`${face.weight} ${face.size}px ${face.family}`)) {
      // check() also returns true for families it has never heard of, so make
      // sure an actual @font-face exists before trusting it.
      const name = face.family.replaceAll('"', '');
      for (const font of document.fonts) {
        if (font.family.replaceAll('"', '') === name && font.status === 'loaded') return face;
      }
    }
  }
  return NUMBER_FACES[NUMBER_FACES.length - 1];
}

export async function loadCardFonts() {
  await Promise.allSettled(NUMBER_FACES.map((f) => document.fonts.load(`${f.weight} ${f.size}px ${f.family}`, '#0123456789')));
}

function drawTokenNumber(ctx, text) {
  const face = numberFace();
  ctx.save();
  ctx.translate(face.cx, face.cy);
  ctx.rotate((face.angle * Math.PI) / 180);
  ctx.font = `${face.weight} ${face.size}px ${face.family}, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const glyphs = [...text];
  const advances = glyphs.map((g) => ctx.measureText(g).width);
  const first = ctx.measureText(glyphs[0]);
  const last = ctx.measureText(glyphs[glyphs.length - 1]);
  const total = advances.reduce((a, b) => a + b, 0) + face.tracking * (glyphs.length - 1);
  // Centre the ink box (not the advance box) on the ribbon.
  const inkLeft = -first.actualBoundingBoxLeft;
  const inkRight = total - advances[advances.length - 1] + last.actualBoundingBoxRight;
  const metrics = ctx.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  let x = -(inkLeft + inkRight) / 2;
  const y = (ascent - descent) / 2;
  ctx.fillStyle = NUMBER_COLOR;
  ctx.strokeStyle = NUMBER_COLOR;
  ctx.lineJoin = 'round';
  ctx.lineWidth = face.stroke * 2;
  glyphs.forEach((glyph, i) => {
    if (face.stroke) ctx.strokeText(glyph, x, y);
    ctx.fillText(glyph, x, y);
    x += advances[i] + face.tracking;
  });
  ctx.restore();
}

/**
 * Compose the card front for one token.
 * @param {HTMLCanvasElement} canvas  target (resized to CARD_TEXTURE)
 * @param {{image:HTMLImageElement,width:number,height:number,pixelated:boolean,background:string|null}} art
 * @param {number|string} tokenId
 */
export async function composeCardFront(canvas, art, tokenId) {
  const template = await loadCardTemplate(tokenId);
  canvas.width = CARD_TEXTURE.width;
  canvas.height = CARD_TEXTURE.height;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(SCALE, SCALE);
  ctx.clearRect(0, 0, TEMPLATE.width, TEMPLATE.height);

  // Art window: background colour first, so art of any aspect fills cleanly.
  ctx.fillStyle = art.background || '#08090b';
  ctx.fillRect(WINDOW.x - 2, WINDOW.y - 2, WINDOW.width + 4, WINDOW.height + 4);
  const height = ART.height;
  const width = (height * art.width) / art.height;
  ctx.imageSmoothingEnabled = !art.pixelated;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(art.image, ART.centerX - width / 2, ART.bottom - height, width, height);
  ctx.imageSmoothingEnabled = true;

  // Frame, ribbon and nameplate sit on top of the art.
  ctx.drawImage(template, 0, 0, TEMPLATE.width, TEMPLATE.height);
  if (Number(tokenId) !== TEMPLATE_NUMBER) drawTokenNumber(ctx, `#${tokenId}`);
  ctx.restore();
  return canvas;
}
