// Лёгкие SVG-графики без библиотек

function niceMax(v) {
  if (v <= 0) return 100;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= v) return m * e;
  return 10 * e;
}

// Столбики с закруглённым верхом, прижатые к оси
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * items: [{ v, label, strong }]
 * opts: { width, height, avg, selected, tick(v) }
 */
export function bars(items, { width, height = 168, avg = 0, selected = -1, tick = String }) {
  const n = items.length;
  const max = niceMax(Math.max(0, ...items.map((i) => i.v)));
  const padL = 40;
  const padR = 2;
  const padT = 8;
  const padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const y = (v) => padT + plotH - (v / max) * plotH;
  const slot = plotW / n;
  const bw = Math.max(2, Math.min(slot - 2, 28));
  let s = `<svg class="chart-bars" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;

  for (const t of [max / 2, max]) {
    const ty = y(t);
    s += `<line class="grid" x1="${padL}" x2="${width - padR}" y1="${ty}" y2="${ty}"/>`;
    s += `<text class="tick" x="${padL - 6}" y="${ty + 3.5}" text-anchor="end">${tick(t)}</text>`;
  }
  s += `<line class="axis" x1="${padL}" x2="${width - padR}" y1="${padT + plotH}" y2="${padT + plotH}"/>`;
  s += `<text class="tick" x="${padL - 6}" y="${padT + plotH + 3.5}" text-anchor="end">0</text>`;

  items.forEach((it, i) => {
    const cx = padL + slot * i + slot / 2;
    if (it.v > 0) {
      const top = y(it.v);
      const h = Math.max(padT + plotH - top, 2);
      const cls = selected === -1 ? 'bar' : i === selected ? 'bar sel' : 'bar dim';
      s += `<path class="${cls}" d="${barPath(cx - bw / 2, padT + plotH - h, bw, h)}"/>`;
    }
    if (it.label) {
      s += `<text class="xl${it.strong ? ' strong' : ''}" x="${cx}" y="${height - 6}" text-anchor="middle">${it.label}</text>`;
    }
  });

  if (avg > 0) {
    const ay = y(avg);
    s += `<line class="avg" x1="${padL}" x2="${width - padR}" y1="${ay}" y2="${ay}"/>`;
  }

  items.forEach((_, i) => {
    s += `<rect class="hit" data-act="bar" data-i="${i}" x="${padL + slot * i}" y="0" width="${slot}" height="${height}"/>`;
  });
  return s + '</svg>';
}

/**
 * segs: [{ id, v, color }] — доли круга
 */
export function donut(segs, { size = 172, stroke = 22, gap = 2, selected = '' } = {}) {
  const c = size / 2;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const total = segs.reduce((a, s) => a + s.v, 0);
  let s = `<svg class="chart-donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img">`;
  s += `<circle class="donut-track" cx="${c}" cy="${c}" r="${r}" stroke-width="${stroke}" fill="none"/>`;
  if (total > 0) {
    let off = 0;
    const g = segs.length > 1 ? gap : 0;
    for (const seg of segs) {
      const len = (seg.v / total) * C;
      const dash = Math.max(len - g, 0.5);
      const cls = !selected ? 'seg' : seg.id === selected ? 'seg sel' : 'seg dim';
      s += `<circle class="${cls}" data-act="seg" data-id="${seg.id}" cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:${seg.color}" stroke-width="${stroke}" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-off}" transform="rotate(-90 ${c} ${c})"/>`;
      off += len;
    }
  }
  return s + '</svg>';
}

// Горизонтальная полоса из долей (например, «кто сколько потратил»)
export function stack(segs) {
  const total = segs.reduce((a, s) => a + s.v, 0) || 1;
  return `<div class="stack">${segs
    .filter((s) => s.v > 0)
    .map((s) => `<i style="flex:${s.v / total};background:${s.color}"></i>`)
    .join('')}</div>`;
}
