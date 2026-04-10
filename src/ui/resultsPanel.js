/**
 * ResultsPanel – renders KPI cards, charts, comparison table, and bottleneck alerts.
 */

import { drawLineChart, drawBarChart } from '../charts/chartRenderer.js';
import { animateCounter } from './animations.js';

/**
 * @param {Array<{label:string, result:object}>} strategyResults – array of { label, result } from simulator
 */
export function renderResults(strategyResults) {
  if (!strategyResults || strategyResults.length === 0) return;

  const primary = strategyResults[0];
  const metrics = primary.result.metrics;
  const ts = primary.result.timeSeries;
  const days = primary.result.days;

  // ---- KPI Cards ----
  const kpiRow = document.getElementById('kpi-row');
  kpiRow.innerHTML = '';
  const kpis = [
    { label: 'Total Cost',     value: metrics.totalCost.mean, prefix: '$', decimals: 0, sub: `Range: $${fmtK(metrics.totalCost.min)} – $${fmtK(metrics.totalCost.max)}` },
    { label: 'Fill Rate',      value: metrics.fillRate.mean * 100, suffix: '%', decimals: 1, sub: `Min: ${(metrics.fillRate.min * 100).toFixed(1)}%` },
    { label: 'Avg Inventory',  value: metrics.avgInventory.mean, decimals: 0, suffix: ' units', sub: `Range: ${Math.round(metrics.avgInventory.min)} – ${Math.round(metrics.avgInventory.max)}` },
    { label: 'Stockout Days',  value: metrics.stockoutDays.mean, decimals: 1, suffix: ' days', sub: `of ${days} simulated days` },
    { label: 'Holding Cost',   value: metrics.holdingCost.mean, prefix: '$', decimals: 0, sub: '' },
    { label: 'Ordering Cost',  value: metrics.orderingCost.mean, prefix: '$', decimals: 0, sub: '' },
  ];

  kpis.forEach(k => {
    const card = document.createElement('div');
    card.className = 'kpi-card';

    const labelEl = document.createElement('div');
    labelEl.className = 'kpi-label';
    labelEl.textContent = k.label;
    card.appendChild(labelEl);

    const valEl = document.createElement('div');
    valEl.className = 'kpi-value';
    valEl.dataset.animate = '1';
    card.appendChild(valEl);

    if (k.sub) {
      const subEl = document.createElement('div');
      subEl.className = 'kpi-sub';
      subEl.textContent = k.sub;
      card.appendChild(subEl);
    }

    kpiRow.appendChild(card);
    animateCounter(valEl, k.value, { prefix: k.prefix || '', suffix: k.suffix || '', decimals: k.decimals });
  });

  // ---- Charts ----
  // Inventory level
  const seriesInv = strategyResults.map(s => ({ label: s.label, data: s.result.timeSeries.stock }));
  drawLineChart(document.getElementById('chart-inventory'), {
    series: seriesInv,
    yLabel: 'Units',
    area: strategyResults.length === 1,
  });

  // Cost breakdown (bar)
  const categories = ['Holding', 'Ordering', 'Stockout'];
  const groups = strategyResults.map(s => ({
    label: s.label,
    values: [s.result.metrics.holdingCost.mean, s.result.metrics.orderingCost.mean, s.result.metrics.stockoutCost.mean],
  }));
  drawBarChart(document.getElementById('chart-costs'), { categories, groups, yLabel: '$' });

  // Fill rate
  const seriesFR = strategyResults.map(s => ({ label: s.label, data: s.result.timeSeries.fillRate }));
  drawLineChart(document.getElementById('chart-fillrate'), {
    series: seriesFR,
    yLabel: 'Fill Rate',
  });

  // Demand vs fulfilled
  drawLineChart(document.getElementById('chart-demand'), {
    series: [
      { label: 'Demand', data: ts.demand, color: '#fbbf24' },
      { label: 'Fulfilled', data: ts.fulfilled, color: '#34d399' },
    ],
    yLabel: 'Units',
    area: false,
  });

  // ---- Comparison Table ----
  const tbody = document.getElementById('comparison-tbody');
  tbody.innerHTML = '';
  let bestIdx = 0;
  let bestCost = Infinity;
  strategyResults.forEach((s, i) => {
    if (s.result.metrics.totalCost.mean < bestCost) { bestCost = s.result.metrics.totalCost.mean; bestIdx = i; }
  });
  strategyResults.forEach((s, i) => {
    const m = s.result.metrics;
    const tr = document.createElement('tr');
    if (i === bestIdx) tr.className = 'best-row';
    tr.innerHTML = `
      <td>${s.label}${i === bestIdx ? ' 🏆' : ''}</td>
      <td>$${fmtK(m.totalCost.mean)}</td>
      <td>$${fmtK(m.holdingCost.mean)}</td>
      <td>$${fmtK(m.orderingCost.mean)}</td>
      <td>$${fmtK(m.stockoutCost.mean)}</td>
      <td>${(m.fillRate.mean * 100).toFixed(1)}%</td>
      <td>${Math.round(m.avgInventory.mean)}</td>
      <td>${m.stockoutDays.mean.toFixed(1)}</td>`;
    tbody.appendChild(tr);
  });

  // ---- Bottleneck Analysis ----
  renderBottlenecks(strategyResults);
}

function renderBottlenecks(strategyResults) {
  const list = document.getElementById('bottleneck-list');
  list.innerHTML = '';
  const primary = strategyResults[0];
  const m = primary.result.metrics;
  const ts = primary.result.timeSeries;
  const days = primary.result.days;

  const alerts = [];

  // Check fill rate
  if (m.fillRate.mean < 0.9) {
    alerts.push({ icon: '🔴', text: `Low fill rate (${(m.fillRate.mean*100).toFixed(1)}%). Consider increasing safety stock or switching to a more responsive reorder policy.`, danger: true });
  } else if (m.fillRate.mean < 0.95) {
    alerts.push({ icon: '🟡', text: `Fill rate at ${(m.fillRate.mean*100).toFixed(1)}%. Minor stockout risk — consider a small safety stock increase.`, warn: true });
  }

  // Check stockout frequency
  const stockoutPct = (m.stockoutDays.mean / days) * 100;
  if (stockoutPct > 15) {
    alerts.push({ icon: '🔴', text: `Stockouts occur on ${stockoutPct.toFixed(1)}% of days. This indicates a significant supply gap.`, danger: true });
  } else if (stockoutPct > 5) {
    alerts.push({ icon: '🟡', text: `Stockouts on ${stockoutPct.toFixed(1)}% of days. Moderate risk.`, warn: true });
  }

  // Check if holding cost dominates
  const holdingPct = m.holdingCost.mean / m.totalCost.mean;
  if (holdingPct > 0.6) {
    alerts.push({ icon: '🟡', text: `Holding cost is ${(holdingPct*100).toFixed(0)}% of total cost. You may be over-stocking. Consider JIT or reducing reorder quantities.`, warn: true });
  }

  // Check if ordering cost dominates
  const orderingPct = m.orderingCost.mean / m.totalCost.mean;
  if (orderingPct > 0.5) {
    alerts.push({ icon: '🟡', text: `Ordering cost is ${(orderingPct*100).toFixed(0)}% of total cost. Consolidating orders with larger batches (EOQ) may reduce costs.`, warn: true });
  }

  // Find inventory dips (periods where stock hits 0 on average)
  let lowStockDays = 0;
  for (const v of ts.stock) if (v < 5) lowStockDays++;
  if (lowStockDays > days * 0.1) {
    alerts.push({ icon: '🔴', text: `Inventory drops near zero on ~${lowStockDays} days (${((lowStockDays/days)*100).toFixed(0)}% of the simulation).`, danger: true });
  }

  if (alerts.length === 0) {
    alerts.push({ icon: '✅', text: 'No significant bottlenecks detected. The current strategy is performing well.' });
  }

  alerts.forEach(a => {
    const div = document.createElement('div');
    div.className = 'bottleneck-item' + (a.warn ? ' warn' : '');
    div.innerHTML = `<span class="bottleneck-icon">${a.icon}</span><span>${a.text}</span>`;
    list.appendChild(div);
  });
}

function fmtK(n) {
  if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
  return Math.round(n).toLocaleString();
}
