/**
 * Simulator – runs a day-by-day inventory simulation.
 *
 * Supports multiple Monte Carlo runs with fresh randomised demand each run.
 * Returns aggregate metrics and per-run time-series for charting.
 */

import { generateDemand } from './demand.js';
import { POLICIES } from './policies.js';

/**
 * Run a single simulation for one product under one policy.
 *
 * @param {object} opts
 * @param {import('./product.js').Product} opts.product
 * @param {import('./warehouse.js').Warehouse} opts.warehouse
 * @param {string} opts.demandType
 * @param {number} opts.demandBase
 * @param {number} opts.demandVariance
 * @param {object} opts.demandExtra
 * @param {string} opts.policyKey
 * @param {object} opts.policyParams
 * @param {number} opts.days
 * @returns {object} run result
 */
function runSingle({
  product,
  warehouse,
  demandType,
  demandBase,
  demandVariance,
  demandExtra,
  policyKey,
  policyParams,
  days,
}) {
  const demand = generateDemand(demandType, days, demandBase, demandVariance, demandExtra);
  const policyFn = POLICIES[policyKey];
  if (!policyFn) throw new Error(`Unknown policy: ${policyKey}`);

  let stock = product.initialStock;
  let totalHoldingCost = 0;
  let totalOrderingCost = 0;
  let totalStockoutCost = 0;
  let stockoutDays = 0;
  let totalDemand = 0;
  let totalFulfilled = 0;
  let ordersPlaced = 0;

  // pending orders queue: { arriveDay, qty }
  const pendingQueue = [];

  // time-series
  const stockSeries = [];
  const demandSeries = [];
  const fulfilledSeries = [];
  const costSeries = [];

  for (let day = 0; day < days; day++) {
    // 1. Receive any arriving orders
    for (let i = pendingQueue.length - 1; i >= 0; i--) {
      if (pendingQueue[i].arriveDay <= day) {
        const incoming = pendingQueue[i].qty;
        const space = warehouse.availableSpace(new Map([['p', stock]]));
        stock += Math.min(incoming, space);
        pendingQueue.splice(i, 1);
      }
    }

    // 2. Demand arrives
    const dayDemand = demand[day];
    totalDemand += dayDemand;
    const fulfilled = Math.min(dayDemand, stock);
    totalFulfilled += fulfilled;
    const unmet = dayDemand - fulfilled;
    stock -= fulfilled;

    if (unmet > 0) {
      stockoutDays++;
      // Lost-sale stockout cost = unmet × unit cost × 1.5 (penalty)
      totalStockoutCost += unmet * product.unitCost * 1.5;
    }

    // 3. Holding cost
    const dayCost = stock * product.holdingCost;
    totalHoldingCost += dayCost;

    // 4. Reorder decision
    let pendingOrderQty = 0;
    for (const o of pendingQueue) pendingOrderQty += o.qty;

    const avgDemand = day > 0 ? totalDemand / (day + 1) : demandBase;
    const orderQty = policyFn({
      day,
      stock,
      product,
      avgDemand,
      demandHistory: demand.slice(0, day + 1),
      pendingOrders: pendingOrderQty,
      params: policyParams,
    });

    if (orderQty > 0) {
      ordersPlaced++;
      totalOrderingCost += product.orderingCost;
      pendingQueue.push({ arriveDay: day + product.leadTime, qty: orderQty });
    }

    // record series
    stockSeries.push(stock);
    demandSeries.push(dayDemand);
    fulfilledSeries.push(fulfilled);
    costSeries.push(dayCost);
  }

  const totalCost = totalHoldingCost + totalOrderingCost + totalStockoutCost;
  const fillRate = totalDemand > 0 ? totalFulfilled / totalDemand : 1;
  const avgInventory = stockSeries.reduce((a, b) => a + b, 0) / days;

  return {
    totalCost,
    totalHoldingCost,
    totalOrderingCost,
    totalStockoutCost,
    fillRate,
    avgInventory,
    stockoutDays,
    ordersPlaced,
    stockSeries,
    demandSeries,
    fulfilledSeries,
    costSeries,
  };
}

/**
 * Run N Monte Carlo simulations and aggregate.
 *
 * @param {object} config – same as runSingle + { runs, onProgress }
 * @returns {object} aggregated results
 */
export async function simulate(config) {
  const { runs = 50, onProgress } = config;
  const allResults = [];

  for (let r = 0; r < runs; r++) {
    allResults.push(runSingle(config));
    if (onProgress) {
      onProgress((r + 1) / runs);
      // yield to UI every 10 runs
      if (r % 10 === 9) await new Promise((res) => setTimeout(res, 0));
    }
  }

  // --- Aggregate ---
  const n = allResults.length;
  const days = config.days;

  const avg = (arr, key) => arr.reduce((s, r) => s + r[key], 0) / n;

  const aggMetrics = {
    totalCost:        { mean: avg(allResults, 'totalCost'),        min: Math.min(...allResults.map(r => r.totalCost)),        max: Math.max(...allResults.map(r => r.totalCost)) },
    holdingCost:      { mean: avg(allResults, 'totalHoldingCost'), min: Math.min(...allResults.map(r => r.totalHoldingCost)), max: Math.max(...allResults.map(r => r.totalHoldingCost)) },
    orderingCost:     { mean: avg(allResults, 'totalOrderingCost'),min: Math.min(...allResults.map(r => r.totalOrderingCost)),max: Math.max(...allResults.map(r => r.totalOrderingCost)) },
    stockoutCost:     { mean: avg(allResults, 'totalStockoutCost'),min: Math.min(...allResults.map(r => r.totalStockoutCost)),max: Math.max(...allResults.map(r => r.totalStockoutCost)) },
    fillRate:         { mean: avg(allResults, 'fillRate'),         min: Math.min(...allResults.map(r => r.fillRate)),         max: Math.max(...allResults.map(r => r.fillRate)) },
    avgInventory:     { mean: avg(allResults, 'avgInventory'),     min: Math.min(...allResults.map(r => r.avgInventory)),     max: Math.max(...allResults.map(r => r.avgInventory)) },
    stockoutDays:     { mean: avg(allResults, 'stockoutDays'),     min: Math.min(...allResults.map(r => r.stockoutDays)),     max: Math.max(...allResults.map(r => r.stockoutDays)) },
    ordersPlaced:     { mean: avg(allResults, 'ordersPlaced'),     min: Math.min(...allResults.map(r => r.ordersPlaced)),     max: Math.max(...allResults.map(r => r.ordersPlaced)) },
  };

  // Average time-series (from all runs)
  const avgSeriesOf = (key) => {
    const s = new Float64Array(days);
    for (const r of allResults) for (let d = 0; d < days; d++) s[d] += r[key][d];
    return Array.from(s, v => v / n);
  };

  const timeSeries = {
    stock:     avgSeriesOf('stockSeries'),
    demand:    avgSeriesOf('demandSeries'),
    fulfilled: avgSeriesOf('fulfilledSeries'),
    cost:      avgSeriesOf('costSeries'),
  };

  // fill-rate over time (cumulative)
  const fillRateSeries = [];
  let cumDemand = 0, cumFulfilled = 0;
  for (let d = 0; d < days; d++) {
    cumDemand += timeSeries.demand[d];
    cumFulfilled += timeSeries.fulfilled[d];
    fillRateSeries.push(cumDemand > 0 ? cumFulfilled / cumDemand : 1);
  }
  timeSeries.fillRate = fillRateSeries;

  return { metrics: aggMetrics, timeSeries, runs: n, days };
}
