/**
 * Animations – counter animation for KPI values, scroll reveals.
 */

/**
 * Animate a number from 0 to target over `duration` ms.
 * @param {HTMLElement} el – element whose textContent to update
 * @param {number} target
 * @param {object} opts
 * @param {string} [opts.prefix]
 * @param {string} [opts.suffix]
 * @param {number} [opts.decimals]
 * @param {number} [opts.duration]
 */
export function animateCounter(el, target, { prefix = '', suffix = '', decimals = 0, duration = 900 } = {}) {
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3); // easeOutCubic

  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const val = ease(t) * target;
    el.textContent = prefix + val.toFixed(decimals) + suffix;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/**
 * Update the simulation progress bar.
 * @param {number} pct – 0..1
 */
export function setProgress(pct) {
  const bar = document.getElementById('sim-progress');
  const label = document.getElementById('sim-progress-label');
  if (bar) bar.style.width = `${(pct * 100).toFixed(1)}%`;
  if (label) label.textContent = pct < 1 ? `Running… ${(pct * 100).toFixed(0)}%` : 'Complete!';
}
