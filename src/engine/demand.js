/**
 * Demand generators – produce an array of daily demand values for a simulation period.
 *
 * Each generator returns number[] of length `days`.
 * Demand values are always ≥ 0 (clamped).
 */

/** Box-Muller normal random */
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Constant demand: base ± noise each day.
 */
export function constantDemand(days, base, variance) {
  const out = [];
  for (let d = 0; d < days; d++) {
    out.push(Math.max(0, Math.round(base + randn() * variance)));
  }
  return out;
}

/**
 * Seasonal demand: sine wave with configurable amplitude and period.
 */
export function seasonalDemand(days, base, variance, amplitude = null, period = 90) {
  const amp = amplitude ?? base * 0.4;
  const out = [];
  for (let d = 0; d < days; d++) {
    const seasonal = amp * Math.sin((2 * Math.PI * d) / period);
    out.push(Math.max(0, Math.round(base + seasonal + randn() * variance)));
  }
  return out;
}

/**
 * Trending demand: linear growth over the period + noise.
 */
export function trendingDemand(days, base, variance, growthRate = 0.15) {
  const out = [];
  const dailyGrowth = (base * growthRate) / days;
  for (let d = 0; d < days; d++) {
    out.push(Math.max(0, Math.round(base + dailyGrowth * d + randn() * variance)));
  }
  return out;
}

/**
 * Random walk demand: each day's demand drifts from the previous value.
 */
export function randomWalkDemand(days, base, variance) {
  const out = [Math.max(0, Math.round(base))];
  for (let d = 1; d < days; d++) {
    const prev = out[d - 1];
    const step = randn() * variance;
    out.push(Math.max(0, Math.round(prev + step)));
  }
  return out;
}

/**
 * Convenience: pick a generator by name.
 */
export function generateDemand(type, days, base, variance, extra = {}) {
  switch (type) {
    case 'seasonal':    return seasonalDemand(days, base, variance, extra.amplitude, extra.period);
    case 'trending':    return trendingDemand(days, base, variance, extra.growthRate);
    case 'random-walk': return randomWalkDemand(days, base, variance);
    case 'constant':
    default:            return constantDemand(days, base, variance);
  }
}
