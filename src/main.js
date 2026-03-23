/**
 * main.js – Application entry point.
 * Wires tabs, initialises panels, and runs simulations.
 */

import { initConfigPanel, getProducts, getWarehouseConfig, getDemandConfig, getPolicyConfig, getSimSettings } from './ui/configPanel.js';
import { initDashboard, refreshSimSummary, getExtraStrategies } from './ui/dashboard.js';
import { renderResults } from './ui/resultsPanel.js';
import { setProgress } from './ui/animations.js';
import { Product } from './engine/product.js';
import { Warehouse } from './engine/warehouse.js';
import { POLICIES } from './engine/policies.js';
import { simulate } from './engine/simulator.js';

/* ============ Tab Navigation ============ */
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(`tab-${target}`);
      if (panel) {
        panel.classList.add('active');
        // Re-trigger animation
        panel.style.animation = 'none';
        panel.offsetHeight; // reflow
        panel.style.animation = '';
      }
      // Refresh summary when entering simulate tab
      if (target === 'simulate') refreshSimSummary();
    });
  });
}

/* ============ Run Simulation ============ */
async function runSimulation() {
  const products = getProducts();
  if (products.length === 0) {
    alert('Please add at least one product before running the simulation.');
    return;
  }

  const wh = getWarehouseConfig();
  const warehouse = new Warehouse(wh);
  const demand = getDemandConfig();
  const primaryPolicy = getPolicyConfig();
  const settings = getSimSettings();

  // Show progress
  const progressWrap = document.getElementById('sim-progress-wrap');
  progressWrap.classList.remove('hidden');
  const runBtn = document.getElementById('btn-run-sim');
  runBtn.disabled = true;
  runBtn.textContent = 'Running…';

  // Build strategy list: primary + extras
  const strategies = [
    { label: POLICIES[primaryPolicy.key]?.label || primaryPolicy.key, policyKey: primaryPolicy.key, policyParams: primaryPolicy.params },
    ...getExtraStrategies(),
  ];

  const strategyResults = [];
  const totalStrategies = strategies.length;

  for (let si = 0; si < strategies.length; si++) {
    const strat = strategies[si];
    // For simplicity, run using the first product
    const product = products[0];

    const result = await simulate({
      product,
      warehouse,
      demandType: demand.type,
      demandBase: demand.base,
      demandVariance: demand.variance,
      demandExtra: demand.extra,
      policyKey: strat.policyKey,
      policyParams: strat.policyParams,
      days: settings.days,
      runs: settings.runs,
      onProgress: (pct) => {
        const overallPct = (si + pct) / totalStrategies;
        setProgress(overallPct);
      },
    });

    strategyResults.push({ label: strat.label, result });
  }

  setProgress(1);

  // Switch to results tab
  setTimeout(() => {
    // Click the results tab
    document.querySelector('.nav-tab[data-tab="results"]').click();
    renderResults(strategyResults);

    // Reset button
    runBtn.disabled = false;
    runBtn.innerHTML = '<span class="btn-icon">▶</span> Run Simulation';
    progressWrap.classList.add('hidden');
  }, 400);
}

/* ============ Init ============ */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initConfigPanel();
  initDashboard();

  document.getElementById('btn-run-sim').addEventListener('click', runSimulation);
});
