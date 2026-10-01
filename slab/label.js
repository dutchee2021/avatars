// Label artwork for the slab, drawn on a <canvas>.
// Proportions follow a 69.2 x 20.6 mm grading label (2048 x 610 px by default).

export const LABEL_SIZE = { width: 2048, height: 610 };

export const LABEL_DEFAULTS = {
  line1: '2024 SET NAME',
  line2: 'PLAYER NAME',
  line3: '',
  cardNo: '#1',
  gradeText: 'GEM MT',
  grade: '10',
  cert: '12345678',
  accent: '#d71f2b',
  logo: 'GRADED',
};

const FONT = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';

// Layout as fractions of the label (measured from a real label).
const L = {
  borderTop: 0.072, borderBottom: 0.095, borderSide: 0.021,
  textLeft: 0.056, textRight: 0.958,
  rows: [0.282, 0.458, 0.634, 0.81],
  fontSize: 0.152,
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

// Decorative barcode derived from the cert number (not a scannable symbology).
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
  ctx.font = `800 ${size}px ${FONT}`;
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

/** Front of the label: set/subject on the left, grade + cert on the right. */
export function drawLabelFront(canvas, opts = {}) {
  const o = { ...LABEL_DEFAULTS, ...opts };
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = o.accent;
  ctx.fillRect(0, 0, w, h);
  const r = innerRect(w, h);
  hologram(ctx, r);

  ctx.fillStyle = '#121212';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${h * L.fontSize}px ${FONT}`;
  const fit = (s, maxW) => {
    let size = h * L.fontSize;
    ctx.font = `400 ${size}px ${FONT}`;
    while (size > h * 0.06 && ctx.measureText(s).width > maxW) {
      size -= 2;
      ctx.font = `400 ${size}px ${FONT}`;
    }
  };
  const left = [o.line1, o.line2, o.line3].filter((s) => s && s.trim());
  ctx.textAlign = 'left';
  left.forEach((s, i) => {
    fit(s.toUpperCase(), w * 0.56);
    ctx.fillText(s.toUpperCase(), w * L.textLeft, h * L.rows[i]);
  });
  ctx.textAlign = 'right';
  [o.cardNo, o.gradeText, o.grade, o.cert].forEach((s, i) => {
    if (!s) return;
    fit(String(s).toUpperCase(), w * 0.3);
    ctx.fillText(String(s).toUpperCase(), w * L.textRight, h * L.rows[i]);
  });

  barcode(ctx, w * 0.052, h * 0.668, w * 0.255, h * 0.15, o.cert);
  if (o.logo) logoBadge(ctx, w * 0.5, h * 0.705, h * 0.295, o.logo.toUpperCase());
  return canvas;
}

/** Back of the label: hologram panel with the cert number and barcode. */
export function drawLabelBack(canvas, opts = {}) {
  const o = { ...LABEL_DEFAULTS, ...opts };
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = o.accent;
  ctx.fillRect(0, 0, w, h);
  const r = innerRect(w, h);
  hologram(ctx, r, 2);
  if (o.logo) logoBadge(ctx, w * 0.2, h * 0.24, h * 0.42, o.logo.toUpperCase());
  barcode(ctx, w * 0.42, h * 0.26, w * 0.4, h * 0.3, o.cert);
  ctx.fillStyle = '#121212';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${h * 0.13}px ${FONT}`;
  ctx.fillText(`CERT ${o.cert || ''}`.trim(), w * 0.62, h * 0.76);
  return canvas;
}
