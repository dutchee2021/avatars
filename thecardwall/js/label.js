// Slab label artwork drawn on a <canvas>: the approved Card Slab Viewer
// template (69.2 x 20.6 mm, 2048 x 610 px) with The Card Wall copy.
// Arimo is bundled (metric-compatible with Arial) so every device draws the
// same label instead of whatever Helvetica/Arial substitute it has.

export const LABEL_SIZE = Object.freeze({ width: 2048, height: 610 });
export const LABEL_FONT = '"CardWall Label", "Helvetica Neue", Helvetica, Arial, sans-serif';

// Layout as fractions of the label (measured from a real grading label).
const L = {
  borderTop: 0.072, borderBottom: 0.095, borderSide: 0.021,
  textLeft: 0.056, textRight: 0.958,
  rows: [0.282, 0.458, 0.634, 0.81],
  fontSize: 0.152,
  leftMaxWidth: 0.68, // room for "$STONKBROKER INTERNS" at full size
  rightMaxWidth: 0.3,
};

function innerRect(w, h) {
  const x = w * L.borderSide, y = h * L.borderTop;
  return { x, y, w: w - 2 * x, h: h - y - h * L.borderBottom };
}

function hologram(ctx, r, seed = 0) {
  const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  g.addColorStop(0, '#f7fafc');
  g.addColorStop(0.45, '#eef4f8');
  g.addColorStop(1, '#f5f8fa');
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  // faint guilloche lines, like security print
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

// Decorative barcode derived from the cert text (not a scannable symbology).
function barcode(ctx, x, y, w, h, text) {
  const bits = [];
  for (const ch of String(text || '0')) {
    const c = ch.charCodeAt(0);
    for (let k = 0; k < 6; k++) bits.push(1 + ((c >> k) & 1) + ((c * (k + 3)) % 3 === 0 ? 1 : 0));
  }
  const total = bits.reduce((a, b) => a + b, 0);
  const unit = w / total;
  ctx.fillStyle = '#111';
  let cx = x;
  bits.forEach((b, i) => {
    if (i % 2 === 0) ctx.fillRect(cx, y, b * unit * 0.9, h);
    cx += b * unit;
  });
}

function logoBadge(ctx, cx, top, h, text) {
  const size = h * 0.36;
  ctx.font = `700 ${size}px ${LABEL_FONT}`;
  const tw = ctx.measureText(text).width;
  const w = Math.max(h * 1.2, tw + h * 0.45);
  const x = cx - w / 2;
  const g = ctx.createLinearGradient(x, top, x + w, top + h);
  g.addColorStop(0, '#9aa3ab');
  g.addColorStop(0.35, '#e9edf0');
  g.addColorStop(0.6, '#b9c1c8');
  g.addColorStop(1, '#dfe4e8');
  ctx.fillStyle = g;
  ctx.fillRect(x, top, w, h);
  ctx.fillStyle = '#1d3f8f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, top + h * 0.5);
}

/** Front: set / collection / chain on the left, token, grade and cert on the right. */
export function drawLabelFront(canvas, o) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = o.accent;
  ctx.fillRect(0, 0, w, h);
  hologram(ctx, innerRect(w, h));

  ctx.fillStyle = '#121212';
  ctx.textBaseline = 'alphabetic';
  const fit = (s, maxW) => {
    let size = h * L.fontSize;
    ctx.font = `400 ${size}px ${LABEL_FONT}`;
    while (size > h * 0.06 && ctx.measureText(s).width > maxW) {
      size -= 2;
      ctx.font = `400 ${size}px ${LABEL_FONT}`;
    }
  };
  ctx.textAlign = 'left';
  [o.line1, o.line2, o.line3].filter(Boolean).forEach((s, i) => {
    fit(s.toUpperCase(), w * L.leftMaxWidth);
    ctx.fillText(s.toUpperCase(), w * L.textLeft, h * L.rows[i]);
  });
  ctx.textAlign = 'right';
  [o.cardNo, o.gradeText, o.grade, o.cert].forEach((s, i) => {
    if (!s) return;
    fit(String(s).toUpperCase(), w * L.rightMaxWidth);
    ctx.fillText(String(s).toUpperCase(), w * L.textRight, h * L.rows[i]);
  });

  barcode(ctx, w * 0.052, h * 0.668, w * 0.255, h * 0.15, o.cert);
  if (o.logo) logoBadge(ctx, w * 0.5, h * 0.705, h * 0.295, o.logo.toUpperCase());
  return canvas;
}

/** Back: hologram panel with the logo badge, barcode and cert line. */
export function drawLabelBack(canvas, o) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = o.accent;
  ctx.fillRect(0, 0, w, h);
  hologram(ctx, innerRect(w, h), 2);
  if (o.logo) logoBadge(ctx, w * 0.2, h * 0.24, h * 0.42, o.logo.toUpperCase());
  barcode(ctx, w * 0.42, h * 0.26, w * 0.4, h * 0.3, o.cert);
  ctx.fillStyle = '#121212';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${h * 0.13}px ${LABEL_FONT}`;
  ctx.fillText(`CERT ${o.cert || ''}`.trim(), w * 0.62, h * 0.76);
  return canvas;
}
