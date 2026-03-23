/**
 * ChartRenderer – lightweight Canvas 2D charting.
 *
 * Supports: line, area, bar, and multi-series line charts.
 * Features: grid lines, axis labels, legends, hover tooltips.
 */

const COLORS = [
  '#6366f1', // indigo
  '#a855f7', // purple
  '#34d399', // emerald
  '#fbbf24', // amber
  '#f87171', // red
  '#38bdf8', // sky
  '#fb923c', // orange
  '#e879f9', // fuchsia
];

function getColor(i) {
  return COLORS[i % COLORS.length];
}

/**
 * Draw a line chart on a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {Array<{label:string, data:number[]}>} opts.series
 * @param {string[]} [opts.xLabels]
 * @param {string} [opts.yLabel]
 * @param {boolean} [opts.area]  – fill area under lines
 * @param {string} [opts.title]
 */
export function drawLineChart(canvas, { series, xLabels, yLabel, area = false, title }) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // margins
  const ml = 55, mr = 20, mt = title ? 35 : 15, mb = 35;
  const cw = W - ml - mr;
  const ch = H - mt - mb;

  // clear
  ctx.clearRect(0, 0, W, H);

  // title
  if (title) {
    ctx.fillStyle = '#9ca3c4';
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, ml, 18);
  }

  // find global min/max
  let yMin = Infinity, yMax = -Infinity;
  for (const s of series) {
    for (const v of s.data) {
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  }
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const yRange = yMax - yMin;
  const yPad = yRange * 0.08;
  yMin -= yPad;
  yMax += yPad;

  const maxLen = Math.max(...series.map(s => s.data.length));
  const xStep = maxLen > 1 ? cw / (maxLen - 1) : cw;

  // helper
  const toX = (i) => ml + i * xStep;
  const toY = (v) => mt + ch - ((v - yMin) / (yMax - yMin)) * ch;

  // grid lines & y-axis labels
  const gridLines = 5;
  ctx.strokeStyle = 'rgba(99,102,241,0.08)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#5e6488';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= gridLines; i++) {
    const val = yMin + ((yMax - yMin) * i) / gridLines;
    const y = toY(val);
    ctx.beginPath();
    ctx.moveTo(ml, y);
    ctx.lineTo(W - mr, y);
    ctx.stroke();
    ctx.fillText(formatNum(val), ml - 6, y + 3);
  }

  // x-axis labels
  if (xLabels) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5e6488';
    const step = Math.max(1, Math.floor(maxLen / 8));
    for (let i = 0; i < maxLen; i += step) {
      ctx.fillText(xLabels[i] ?? String(i), toX(i), H - mb + 18);
    }
  } else if (maxLen > 1) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5e6488';
    const step = Math.max(1, Math.floor(maxLen / 8));
    for (let i = 0; i < maxLen; i += step) {
      ctx.fillText(`Day ${i + 1}`, toX(i), H - mb + 18);
    }
  }

  // y label
  if (yLabel) {
    ctx.save();
    ctx.translate(12, mt + ch / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#5e6488';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }

  // draw series
  series.forEach((s, si) => {
    const color = getColor(si);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    for (let i = 0; i < s.data.length; i++) {
      const x = toX(i);
      const y = toY(s.data[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // area fill
    if (area) {
      ctx.beginPath();
      for (let i = 0; i < s.data.length; i++) {
        const x = toX(i);
        const y = toY(s.data[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(toX(s.data.length - 1), toY(yMin));
      ctx.lineTo(toX(0), toY(yMin));
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, mt, 0, mt + ch);
      grad.addColorStop(0, color + '30');
      grad.addColorStop(1, color + '05');
      ctx.fillStyle = grad;
      ctx.fill();
    }
  });

  // legend
  if (series.length > 1) {
    ctx.font = '10px Inter, sans-serif';
    let lx = ml;
    series.forEach((s, si) => {
      const color = getColor(si);
      ctx.fillStyle = color;
      ctx.fillRect(lx, H - 10, 10, 3);
      ctx.fillStyle = '#9ca3c4';
      ctx.textAlign = 'left';
      ctx.fillText(s.label, lx + 14, H - 6);
      lx += ctx.measureText(s.label).width + 28;
    });
  }
}

/**
 * Draw a grouped bar chart.
 */
export function drawBarChart(canvas, { categories, groups, yLabel, title }) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const ml = 65, mr = 20, mt = title ? 35 : 15, mb = 50;
  const cw = W - ml - mr;
  const ch = H - mt - mb;

  ctx.clearRect(0, 0, W, H);

  if (title) {
    ctx.fillStyle = '#9ca3c4';
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, ml, 18);
  }

  // find max value
  let yMax = 0;
  for (const g of groups) {
    for (const v of g.values) if (v > yMax) yMax = v;
  }
  yMax *= 1.15;
  if (yMax === 0) yMax = 1;

  const catCount = categories.length;
  const grpCount = groups.length;
  const catWidth = cw / catCount;
  const barWidth = Math.min(28, (catWidth * 0.7) / grpCount);
  const grpWidth = barWidth * grpCount;

  const toY = (v) => mt + ch - (v / yMax) * ch;

  // grid
  ctx.strokeStyle = 'rgba(99,102,241,0.08)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#5e6488';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const val = (yMax * i) / 5;
    const y = toY(val);
    ctx.beginPath();
    ctx.moveTo(ml, y);
    ctx.lineTo(W - mr, y);
    ctx.stroke();
    ctx.fillText('$' + formatNum(val), ml - 6, y + 3);
  }

  // bars
  groups.forEach((g, gi) => {
    const color = getColor(gi);
    g.values.forEach((v, ci) => {
      const cx = ml + ci * catWidth + catWidth / 2;
      const bx = cx - grpWidth / 2 + gi * barWidth;
      const by = toY(v);
      const bh = mt + ch - by;

      // bar with rounded top
      ctx.fillStyle = color;
      ctx.beginPath();
      const r = Math.min(4, barWidth / 2);
      ctx.moveTo(bx, mt + ch);
      ctx.lineTo(bx, by + r);
      ctx.quadraticCurveTo(bx, by, bx + r, by);
      ctx.lineTo(bx + barWidth - r, by);
      ctx.quadraticCurveTo(bx + barWidth, by, bx + barWidth, by + r);
      ctx.lineTo(bx + barWidth, mt + ch);
      ctx.closePath();
      ctx.fill();

      // glow
      const grad = ctx.createLinearGradient(bx, by, bx, mt + ch);
      grad.addColorStop(0, color + '40');
      grad.addColorStop(1, color + '00');
      ctx.fillStyle = grad;
      ctx.fill();
    });
  });

  // category labels
  ctx.fillStyle = '#9ca3c4';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  categories.forEach((c, i) => {
    const cx = ml + i * catWidth + catWidth / 2;
    ctx.fillText(c, cx, H - mb + 18);
  });

  // legend
  ctx.font = '10px Inter, sans-serif';
  let lx = ml;
  groups.forEach((g, gi) => {
    const color = getColor(gi);
    ctx.fillStyle = color;
    ctx.fillRect(lx, H - 12, 10, 3);
    ctx.fillStyle = '#9ca3c4';
    ctx.textAlign = 'left';
    ctx.fillText(g.label, lx + 14, H - 8);
    lx += ctx.measureText(g.label).width + 28;
  });
}

/**
 * Tiny demand-preview sparkline (for config panel).
 */
export function drawSparkline(canvas, data) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, W, H);

  if (!data || data.length === 0) return;

  let min = Infinity, max = -Infinity;
  for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
  if (min === max) { min -= 1; max += 1; }

  const pad = 8;
  const cw = W - pad * 2;
  const ch = H - pad * 2;
  const step = cw / (data.length - 1);

  const toX = (i) => pad + i * step;
  const toY = (v) => pad + ch - ((v - min) / (max - min)) * ch;

  // area
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = toX(i);
    const y = toY(data[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(toX(data.length - 1), H - pad);
  ctx.lineTo(pad, H - pad);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad, 0, H - pad);
  grad.addColorStop(0, 'rgba(99,102,241,0.25)');
  grad.addColorStop(1, 'rgba(99,102,241,0.02)');
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = toX(i);
    const y = toY(data[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function formatNum(n) {
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}
