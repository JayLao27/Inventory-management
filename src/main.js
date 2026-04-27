/**
 * main.js – Application entry point.
 * Wires tabs and initialises panels.
 */

import { initConfigPanel, getProducts, getWarehouseConfig, getDemandConfig, getPolicyConfig, getSimSettings } from './ui/configPanel.js';
import { initDashboard, refreshSimSummary, refreshPlaybackProductOptions, getExtraStrategies } from './ui/dashboard.js';
import { renderResults } from './ui/resultsPanel.js';
import { simulateStore } from './engine/simulator.js';
import { Warehouse } from './engine/warehouse.js';
import { POLICIES } from './engine/policies.js';

let resultsReady = false;
let resultsGenerating = false;

function setResultsTabEnabled(enabled) {
  const resultsTab = document.querySelector('.nav-tab[data-tab="results"]');
  if (!resultsTab) return;
  resultsTab.classList.toggle('disabled', !enabled);
  resultsTab.setAttribute('aria-disabled', String(!enabled));
}

async function generateResultsFromCurrentConfig() {
  if (resultsGenerating) return;

  const products = getProducts();
  if (products.length === 0) {
    alert('Please add at least one product before generating results.');
    return;
  }

  resultsGenerating = true;
  try {
    const wh = getWarehouseConfig();
    const demand = getDemandConfig();
    const primaryPolicy = getPolicyConfig();
    const settings = getSimSettings();
    const warehouse = new Warehouse(wh);

    const strategies = [
      { label: POLICIES[primaryPolicy.key]?.label || primaryPolicy.key, policyKey: primaryPolicy.key, policyParams: primaryPolicy.params },
      ...getExtraStrategies(),
    ];

    const strategyResults = [];
    for (const strat of strategies) {
      const result = await simulateStore({
        products,
        warehouse,
        demandType: demand.type,
        demandBase: demand.base,
        demandVariance: demand.variance,
        demandExtra: demand.extra,
        policyKey: strat.policyKey,
        policyParams: strat.policyParams,
        days: settings.days,
        runs: settings.runs,
      });
      strategyResults.push({ label: strat.label, result });
    }

    renderResults(strategyResults);
    resultsReady = true;
    setResultsTabEnabled(true);
    document.querySelector('.nav-tab[data-tab="results"]')?.click();
  } finally {
    resultsGenerating = false;
  }
}

/* ============ Tab Navigation ============ */
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      if (target === 'results' && !resultsReady) {
        alert('Complete the Process Flow first to generate and open Results.');
        return;
      }
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
      if (target === 'simulate') {
        refreshSimSummary();
        refreshPlaybackProductOptions();
      }
    });
  });
}

/* ============ Init ============ */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initConfigPanel();
  initDashboard();
  refreshSimSummary();
  refreshPlaybackProductOptions();
  setResultsTabEnabled(false);

  window.addEventListener('process-flow-initialized', () => {
    resultsReady = false;
    setResultsTabEnabled(false);
  });

  window.addEventListener('process-flow-complete', () => {
    generateResultsFromCurrentConfig();
  });
});
  