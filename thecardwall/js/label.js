// Slab label: the approved label artwork from the STONKSLAB sample
// (assets/label-front.jpg and assets/label-back.jpg, byte-for-byte), drawn
// by the Card Slab Viewer label template. Only the two fields that change per
// token are redrawn, with that template's own paper, font, size and layout:
// the collection line ($STONKBROKER / $STONKBROKER INTERNS) and the #ID.

export const LABEL_SIZE = Object.freeze({ width: 2048, height: 610 });

// The template's font stack is "Helvetica Neue", Helvetica, Arial. iPhone,
// iPad and Mac have Helvetica Neue, so redrawn fields match the artwork
// exactly there; elsewhere a bundled Helvetica clone (FreeSans) stands in.
export const LABEL_FONT = '"Helvetica Neue", "CardWall Helvetica", Helvetica, Arial, sans-serif';
const TEXT_COLOR = '#121212';

// What the approved artwork already says; matching fields are left untouched.
const ARTWORK = Object.freeze({ line2: '$STONKBROKER', cardNo: '#4354' });

// Label template layout (fractions of the label), as in ../slab/label.js.
const L = {
  borderTop: 0.072, borderBottom: 0.095, borderSide: 0.021,
  textLeft: 0.056, textRight: 0.958,
  rows: [0.282, 0.458, 0.634, 0.81],
  fontSize: 0.152,
};

// Per field: template row and alignment, the template's auto-fit width, and
// the area cleared back to bare paper (px on the 2048 x 610 label), which
// covers the artwork's original text with a margin and nothing else.
const FIELDS = Object.freeze({
  line2: { row: 1, align: 'left', maxWidth: 0.56, clear: { x: 96, y: 184, w: 800, h: 116 } },
  cardNo: { row: 0, align: 'right', maxWidth: 0.3, clear: { x: 1560, y: 64, w: 430, h: 128 } },
});

function innerRect(w, h) {
  const x = w * L.borderSide, y = h * L.borderTop;
  return { x, y, w: w - 2 * x, h: h - y - h * L.borderBottom };
}

// The template's paper: soft gradient plus faint guilloche lines (same code
// and seed as the template, so a cleared field blends into the artwork).
function hologram(ctx, r, seed = 0) {
  const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  g.addColorStop(0, '#f7fafc');
  g.addColorStop(0.45, '#eef4f8');
  g.addColorStop(1, '#f5f8fa');
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.lineWidth = Math.max(1, r.h * 0.004);
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = `rgba(120, 165, 200, ${0.05 + 0.04 * Math.sin(i + seed)})`;
    ctx.beginPath();
    const y0 = r.y + (i / 25) * r.h;
    for (let x = r.x; x <= r.x + r.w; x += 8) {
      const t = (x - r.x) / r.w;
      ctx.lineTo(x, y0 + Math.sin(t * 14 + i * 0.7 + seed) * r.h * 0.05 + Math.sin(t * 41 + i) * r.h * 0.012);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

let artworkPromise;
/** The approved label artwork, front and back. */
export function loadLabelArtwork() {
  artworkPromise ??= Promise.all([loadImage('assets/label-front.jpg'), loadImage('assets/label-back.jpg')])
    .then(([front, back]) => ({ front, back }));
  return artworkPromise;
}

/** Make sure the label font (or its stand-in) is ready before drawing. */
export function loadLabelFont() {
  return document.fonts.load(`400 ${LABEL_SIZE.height * L.fontSize}px ${LABEL_FONT}`, '$#0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ');
}

function redrawField(ctx, field, text) {
  const { width: w, height: h } = LABEL_SIZE;
  const { clear } = field;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clear.x, clear.y, clear.w, clear.h);
  ctx.clip();
  hologram(ctx, innerRect(w, h));
  ctx.restore();

  // The template's auto-fit: shrink in 2 px steps until the text fits.
  let size = h * L.fontSize;
  ctx.font = `400 ${size}px ${LABEL_FONT}`;
  while (size > h * 0.06 && ctx.measureText(text).width > w * field.maxWidth) {
    size -= 2;
    ctx.font = `400 ${size}px ${LABEL_FONT}`;
  }
  ctx.fillStyle = TEXT_COLOR;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = field.align;
  ctx.fillText(text, w * (field.align === 'left' ? L.textLeft : L.textRight), h * L.rows[field.row]);
}

/**
 * Front of the label for one token.
 * @param {HTMLCanvasElement} canvas
 * @param {{front: HTMLImageElement}} artwork from loadLabelArtwork()
 * @param {{line2: string, cardNo: string}} fields
 */
export function drawLabelFront(canvas, artwork, fields) {
  canvas.width = LABEL_SIZE.width;
  canvas.height = LABEL_SIZE.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(artwork.front, 0, 0, canvas.width, canvas.height);
  for (const [name, field] of Object.entries(FIELDS)) {
    const text = String(fields[name] ?? '').toUpperCase();
    if (text !== ARTWORK[name]) redrawField(ctx, field, text);
  }
  return canvas;
}

/** Back of the label: the approved artwork, unchanged for every token. */
export function drawLabelBack(canvas, artwork) {
  canvas.width = LABEL_SIZE.width;
  canvas.height = LABEL_SIZE.height;
  canvas.getContext('2d').drawImage(artwork.back, 0, 0, canvas.width, canvas.height);
  return canvas;
}
