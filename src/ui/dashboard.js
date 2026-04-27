/**
 * Dashboard – orchestrates tabs, simulation summary, strategy comparison builder.
 */

import { getProducts, getWarehouseConfig, getDemandConfig, getPolicyConfig, getSimSettings } from './configPanel.js';
import { POLICIES } from '../engine/policies.js';
import { createStorePlaybackSimulation, stepStorePlaybackDay } from '../engine/simulator.js';
import { Warehouse } from '../engine/warehouse.js';
import { initProcess3DScene, setProcess3DStage, updateProcess3DScene, resizeProcess3DScene } from './process3d.js';

/** @type {Array<{label:string, policyKey:string, policyParams:object}>} */
let extraStrategies = [];
let playbackState = null;
let playbackTimer = null;
let playbackStepping = false;
let autoPlaybackEnabled = false;
let playbackBaseStock = 1;
let playbackFlowState = null;
let editingStrategyIndex = -1;
const PLAYBACK_ACTION_BUTTON_IDS = ['btn-init-playback', 'btn-next-day', 'btn-auto-day', 'btn-skip-period'];

function getPlaybackAdvanceMode() {
  const mode = document.getElementById('playback-advance-mode')?.value;
  return mode === 'step' ? 'step' : 'day';
}

function updatePlaybackControlLabels() {
  const mode = getPlaybackAdvanceMode();
  const nextBtn = document.getElementById('btn-next-day');
  const autoBtn = document.getElementById('btn-auto-day');
  if (nextBtn) nextBtn.textContent = mode === 'step' ? 'Next Step' : 'Next Day';
  if (autoBtn) autoBtn.textContent = autoPlaybackEnabled
    ? (mode === 'step' ? 'Pause Auto Step' : 'Pause Auto Day')
    : (mode === 'step' ? 'Start Auto Step' : 'Start Auto Day');
}

function buildPresetStrategies() {
  const presets = [];

  // ROP variants (12)
  const ropConfigs = [
    { label: 'ROP 1', reorderPoint: 45, orderQty: 180 },
    { label: 'ROP 2', reorderPoint: 70, orderQty: 300 },
    { label: 'ROP 3', reorderPoint: 55, orderQty: 220 },
    { label: 'ROP 4', reorderPoint: 60, orderQty: 240 },
    { label: 'ROP 5', reorderPoint: 65, orderQty: 260 },
    { label: 'ROP 6', reorderPoint: 75, orderQty: 320 },
    { label: 'ROP 7', reorderPoint: 80, orderQty: 340 },
    { label: 'ROP 8', reorderPoint: 85, orderQty: 360 },
    { label: 'ROP 9', reorderPoint: 90, orderQty: 380 },
    { label: 'ROP 10', reorderPoint: 95, orderQty: 400 },
    { label: 'ROP 11', reorderPoint: 50, orderQty: 280 },
    { label: 'ROP 12', reorderPoint: 100, orderQty: 420 },
  ];
  ropConfigs.forEach((cfg) => {
    presets.push({
      label: cfg.label,
      policyKey: 'rop',
      policyParams: { reorderPoint: cfg.reorderPoint, orderQty: cfg.orderQty },
    });
  });

  // EOQ variants (10)
  [0.8, 1.0, 1.2, 1.35, 1.5, 1.65, 1.8, 2.0, 2.3, 2.6].forEach((sf, idx) => {
    presets.push({
      label: `EOQ ${idx + 1}`,
      policyKey: 'eoq',
      policyParams: { safetyFactor: sf },
    });
  });

  return presets;
}

function seedPresetStrategies() {
  if (extraStrategies.length > 0) return;
  extraStrategies = buildPresetStrategies();
}

export function getExtraStrategies() { return extraStrategies; }

function formatCurrency(value) {
  return `₱${value.toFixed(2)}`;
}

function setFlowStage(stageId) {
  const stages = document.querySelectorAll('.flow-node');
  stages.forEach((el) => el.classList.remove('active'));
  if (!stageId) return;
  const target = document.querySelector(`.flow-node[data-stage="${stageId}"]`);
  if (target) target.classList.add('active');
}

function moveTruckToStage(stageId) {
  const truck = document.getElementById('flow-truck');
  const chart = document.getElementById('process-flow-chart');
  const node = chart?.querySelector(`.flow-node[data-stage="${stageId}"]`);
  if (!truck || !chart || !node) return;

  const chartRect = chart.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const x = nodeRect.left - chartRect.left + (nodeRect.width / 2) - 14;
  const y = nodeRect.top - chartRect.top + (nodeRect.height / 2) - 14;
  truck.style.transform = `translate(${x}px, ${y}px)`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStepDelayMs() {
  return Math.max(90, Math.round(getPlaybackSpeedMs() * 0.45));
}

function buildFlowPath(snapshot) {
  const flowPath = ['start-day', 'daily-sales', 'check-inventory'];

  if (snapshot.unmet > 0) {
    flowPath.push('lost-customer', 'tally-lost');
  }

  flowPath.push('reduce-inventory', 'reorder-check');

  if (snapshot.placedOrderQty > 0) {
    flowPath.push('create-po', 'place-order', 'supplier-lead', 'trigger-reorder');
  }

  if (snapshot.receivedQty > 0) {
    flowPath.push('stock-received');
  }

  flowPath.push('total', 'end-day');
  return flowPath;
}

function setPlaybackFlowState(snapshot, stageIndex = 0) {
  const flowPath = buildFlowPath(snapshot);
  playbackFlowState = {
    snapshot,
    flowPath,
    stageIndex: Math.max(0, Math.min(stageIndex, flowPath.length - 1)),
  };
}

function renderPlaybackStep(stage, snapshot) {
  setProcess3DStage(stage);
  setFlowStage(stage);
  moveTruckToStage(stage);
  updateProcess3DScene({
    stock: snapshot.stock,
    baseStock: playbackBaseStock,
    demand: snapshot.demand,
    pendingOrders: snapshot.pendingOrders,
    nextReceiptDays: snapshot.nextReceiptDays,
    placedOrderQty: snapshot.placedOrderQty,
    receivedQty: snapshot.receivedQty,
  });
  animatePOTruck(snapshot.placedOrderQty, snapshot.receivedQty, snapshot.nextReceiptDays);
  renderPlaybackStats(snapshot);
  renderDemandAndServed(snapshot.demand, snapshot.fulfilled, snapshot.unmet);
  renderInventoryRack(snapshot.stock);
  refreshLiveResults();
}

async function animateFlowPath(path) {
  const delay = getStepDelayMs();
  for (const stage of path) {
    setProcess3DStage(stage);
    setFlowStage(stage);
    moveTruckToStage(stage);
    await wait(delay);
  }
}

function appendPlaybackLog(line) {
  const log = document.getElementById('playback-log');
  if (!log) return;
  const entry = document.createElement('p');
  entry.textContent = line;
  log.prepend(entry);
}

function clearChildren(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

function ensureInventoryRack() {
  const rack = document.getElementById('inventory-rack');
  if (!rack) return;
  if (rack.children.length > 0) return;
  for (let i = 0; i < 16; i++) {
    const slot = document.createElement('div');
    slot.className = 'inventory-slot';
    rack.appendChild(slot);
  }
}

function renderInventoryRack(stock) {
  ensureInventoryRack();
  const rack = document.getElementById('inventory-rack');
  if (!rack) return;
  const slots = Array.from(rack.children);
  const ratio = Math.max(0, Math.min(1, stock / Math.max(1, playbackBaseStock)));
  const filledCount = Math.round(ratio * slots.length);
  slots.forEach((slot, idx) => {
    slot.classList.toggle('filled', idx < filledCount);
  });
}

function renderDemandAndServed(demand, fulfilled, unmet) {
  const demandWrap = document.getElementById('customer-stream');
  const servedWrap = document.getElementById('served-people');
  clearChildren(demandWrap);
  clearChildren(servedWrap);

  const maxDemandDots = 24;
  const totalDots = demand > 0 ? Math.min(maxDemandDots, Math.max(1, Math.round(demand / 3))) : 0;
  const servedRatio = demand > 0 ? fulfilled / demand : 0;
  const servedDots = Math.round(totalDots * servedRatio);

  for (let i = 0; i < totalDots; i++) {
    const dot = document.createElement('span');
    dot.className = `customer-dot ${i < servedDots ? 'served' : 'unmet'}`;
    dot.style.animationDelay = `${i * 25}ms`;
    demandWrap?.appendChild(dot);
  }

  const servedPeopleDots = fulfilled > 0 ? Math.min(24, Math.max(1, Math.round(fulfilled / 3))) : 0;
  for (let i = 0; i < servedPeopleDots; i++) {
    const dot = document.createElement('span');
    dot.className = 'served-dot';
    dot.style.animationDelay = `${i * 20}ms`;
    servedWrap?.appendChild(dot);
  }

  if (demand === 0 && demandWrap) {
    const quiet = document.createElement('span');
    quiet.className = 'item-meta';
    quiet.textContent = 'No demand yet for current day.';
    demandWrap.appendChild(quiet);
  }

  if (fulfilled === 0 && unmet > 0 && servedWrap) {
    const empty = document.createElement('span');
    empty.className = 'item-meta';
    empty.textContent = 'Customers could not get items today.';
    servedWrap.appendChild(empty);
  }
}

function setPODeliveryStatus(text) {
  const status = document.getElementById('po-delivery-status');
  if (status) status.textContent = text;
}

function setStrategyComparisonLocked(locked) {
  const addBtn = document.getElementById('btn-add-strategy');
  const note = document.getElementById('strategy-dependency-note');
  if (addBtn) addBtn.disabled = false;
  if (note) note.classList.toggle('hidden', !locked);
  if (locked) closeStrategyForm();
}

function openStrategyModal() {
  const modal = document.getElementById('strategy-form-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeStrategyForm() {
  const modal = document.getElementById('strategy-form-modal');
  if (modal) modal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  editingStrategyIndex = -1;
  const title = document.getElementById('strategy-form-title');
  if (title) title.textContent = 'Add Comparison Strategy';
  const saveBtn = document.getElementById('btn-save-strategy');
  if (saveBtn) saveBtn.textContent = 'Save';
}

function animatePOTruck(placedOrderQty, receivedQty, nextReceiptDays = null) {
  const truck = document.getElementById('po-truck');
  if (!truck) return;

  truck.classList.remove('delivering');
  if (placedOrderQty > 0) {
    void truck.offsetWidth;
    truck.classList.add('delivering');
    const etaText = Number.isFinite(nextReceiptDays)
      ? ` ETA to warehouse: ${nextReceiptDays} day${nextReceiptDays === 1 ? '' : 's'}.`
      : '';
    setPODeliveryStatus(`Purchase order placed: ${placedOrderQty} units. Truck is delivering to warehouse.${etaText}`);
    return;
  }

  if (receivedQty > 0) {
    setPODeliveryStatus(`Stock received today: ${receivedQty} units.`);
  } else {
    setPODeliveryStatus('No purchase order for this day yet.');
  }
}

function renderPlaybackStats(snapshot = null) {
  const status = document.getElementById('playback-status');
  if (!status) return;

  if (!snapshot) {
    status.innerHTML = `
      <div class="playback-pill">Day: <strong>0 / 0</strong></div>
      <div class="playback-pill">Stock: <strong>0</strong></div>
      <div class="playback-pill">Demand: <strong>0</strong></div>
      <div class="playback-pill">Pending Orders: <strong>0</strong></div>
      <div class="playback-pill">Fill Rate: <strong>0.00%</strong></div>
      <div class="playback-pill">Total Cost: <strong>₱0.00</strong></div>
    `;
    return;
  }

  status.innerHTML = `
    <div class="playback-pill">Day: <strong>${snapshot.day} / ${snapshot.days}</strong></div>
    <div class="playback-pill">Stock: <strong>${snapshot.stock}</strong></div>
    <div class="playback-pill">Demand: <strong>${snapshot.demand}</strong></div>
    <div class="playback-pill">Pending Orders: <strong>${snapshot.pendingOrders}</strong></div>
    <div class="playback-pill">Fill Rate: <strong>${(snapshot.fillRate * 100).toFixed(2)}%</strong></div>
    <div class="playback-pill">Total Cost: <strong>${formatCurrency(snapshot.totalCost)}</strong></div>
  `;
}

function computeLiveMetricsFromState(state) {
  const totalCost = state.totalHoldingCost + state.totalOrderingCost + state.totalStockoutCost;
  const fillRate = state.totalDemand > 0 ? state.totalFulfilled / state.totalDemand : 1;
  const avgInventory = state.stockSeries.length > 0
    ? state.stockSeries.reduce((sum, v) => sum + v, 0) / state.stockSeries.length
    : state.stock;

  return {
    day: state.day,
    days: state.days,
    totalCost,
    fillRate,
    avgInventory,
    stockoutDays: state.stockoutDays,
    ordersPlaced: state.ordersPlaced,
  };
}

function renderLiveResultsKpis() {
  const wrap = document.getElementById('live-results-kpis');
  const caption = document.getElementById('live-results-caption');
  if (!wrap) return;

  if (!playbackState) {
    if (caption) caption.textContent = 'Initialize playback to start real-time KPI and strategy comparison updates.';
    wrap.innerHTML = `
      <div class="playback-pill">Day: <strong>0 / 0</strong></div>
      <div class="playback-pill">Total Cost: <strong>₱0.00</strong></div>
      <div class="playback-pill">Fill Rate: <strong>0.00%</strong></div>
      <div class="playback-pill">Avg Inventory: <strong>0</strong></div>
      <div class="playback-pill">Stockout Days: <strong>0</strong></div>
      <div class="playback-pill">Orders Placed: <strong>0</strong></div>
    `;
    return;
  }

  const m = computeLiveMetricsFromState(playbackState);
  if (caption) {
    caption.textContent = `Live through day ${m.day} of ${m.days}. Comparison uses the same demand sequence for all strategies up to the current day.`;
  }

  wrap.innerHTML = `
    <div class="playback-pill">Day: <strong>${m.day} / ${m.days}</strong></div>
    <div class="playback-pill">Total Cost: <strong>${formatCurrency(m.totalCost)}</strong></div>
    <div class="playback-pill">Fill Rate: <strong>${(m.fillRate * 100).toFixed(2)}%</strong></div>
    <div class="playback-pill">Avg Inventory: <strong>${Math.round(m.avgInventory)}</strong></div>
    <div class="playback-pill">Stockout Days: <strong>${m.stockoutDays}</strong></div>
    <div class="playback-pill">Orders Placed: <strong>${m.ordersPlaced}</strong></div>
  `;
}

function simulateStrategyForElapsedDays({ label, policyKey, policyParams, elapsedDays }) {
  const wh = getWarehouseConfig();
  const demand = getDemandConfig();
  const products = getProducts();
  if (!products.length) return null;

  const simDays = Math.max(1, elapsedDays);
  const sim = createStorePlaybackSimulation({
    products,
    warehouse: new Warehouse(wh),
    demandType: demand.type,
    demandBase: demand.base,
    demandVariance: demand.variance,
    demandExtra: demand.extra,
    policyKey,
    policyParams,
    days: simDays,
  });

  // Keep strategy comparison fair by replaying with the same realized demand curves per product.
  if (playbackState?.demandsBySku) {
    sim.productStates.forEach((ps) => {
      const shared = playbackState.demandsBySku[ps.product.sku];
      if (Array.isArray(shared)) ps.demand = shared.slice(0, simDays);
    });
    sim.demandsBySku = Object.fromEntries(sim.productStates.map((ps) => [ps.product.sku, ps.demand.slice()]));
  }

  while (!sim.done && sim.day < elapsedDays) {
    stepStorePlaybackDay(sim);
  }

  const m = computeLiveMetricsFromState(sim);
  return {
    label,
    totalCost: m.totalCost,
    fillRate: m.fillRate,
    avgInventory: m.avgInventory,
    stockoutDays: m.stockoutDays,
  };
}

function renderLiveStrategyComparison() {
  const tbody = document.getElementById('live-comparison-tbody');
  if (!tbody) return;

  if (!playbackState) {
    tbody.innerHTML = '<tr><td colspan="5">Initialize playback to see live strategy comparison.</td></tr>';
    return;
  }

  const elapsedDays = playbackState.day;
  const primaryPolicy = getPolicyConfig();
  const strategies = [
    {
      label: POLICIES[primaryPolicy.key]?.label || primaryPolicy.key,
      policyKey: primaryPolicy.key,
      policyParams: primaryPolicy.params,
    },
    ...extraStrategies,
  ];

  const rows = strategies
    .map((s) => simulateStrategyForElapsedDays({ ...s, elapsedDays }))
    .filter(Boolean);

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No strategies available yet.</td></tr>';
    return;
  }

  let bestIdx = 0;
  let bestCost = Infinity;
  rows.forEach((row, idx) => {
    if (row.totalCost < bestCost) {
      bestCost = row.totalCost;
      bestIdx = idx;
    }
  });

  tbody.innerHTML = '';
  rows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    if (idx === bestIdx) tr.className = 'best-row';
    tr.innerHTML = `
      <td>${row.label}${idx === bestIdx ? ' 🏆' : ''}</td>
      <td>${formatCurrency(row.totalCost)}</td>
      <td>${(row.fillRate * 100).toFixed(2)}%</td>
      <td>${Math.round(row.avgInventory)}</td>
      <td>${row.stockoutDays}</td>
    `;
    tbody.appendChild(tr);
  });
}

function refreshLiveResults() {
  renderLiveResultsKpis();
  renderLiveStrategyComparison();
}

function getPlaybackSpeedMs() {
  const speed = document.getElementById('playback-speed')?.value || '1x';
  const speedMap = {
    '0.5x': 1400,
    '1x': 800,
    '2x': 400,
    '4x': 220,
    '8x': 120,
  };
  return speedMap[speed] || 800;
}

function stopAutoPlayback() {
  if (playbackTimer) {
    clearTimeout(playbackTimer);
    playbackTimer = null;
  }
  autoPlaybackEnabled = false;
  updatePlaybackControlLabels();
}

function setPlaybackButtonsEnabled(enabled) {
  const nextBtn = document.getElementById('btn-next-day');
  const autoBtn = document.getElementById('btn-auto-day');
  const skipBtn = document.getElementById('btn-skip-period');
  const skipSelect = document.getElementById('playback-skip-interval');
  if (nextBtn) nextBtn.disabled = !enabled;
  if (autoBtn) autoBtn.disabled = !enabled;
  if (skipBtn) skipBtn.disabled = !enabled;
  if (skipSelect) skipSelect.disabled = !enabled;
}

function setActivePlaybackAction(activeButtonId) {
  for (const buttonId of PLAYBACK_ACTION_BUTTON_IDS) {
    const btn = document.getElementById(buttonId);
    if (!btn) continue;
    const isActive = buttonId === activeButtonId;
    btn.classList.toggle('btn-primary', isActive);
    btn.classList.toggle('btn-outline', !isActive);
  }
}

async function runNextPlaybackDay() {
  if (getPlaybackAdvanceMode() === 'step') {
    await runNextPlaybackStep();
    return;
  }

  await runNextPlaybackDayOnly();
}

async function runNextPlaybackDayOnly() {
  if (!playbackState || playbackStepping) return;
  setActivePlaybackAction('btn-next-day');

  playbackStepping = true;

  const nextBtn = document.getElementById('btn-next-day');
  if (nextBtn) nextBtn.disabled = true;

  try {
    if (!playbackState || playbackState.done) {
      setPlaybackButtonsEnabled(false);
      return;
    }

    const snapshot = stepStorePlaybackDay(playbackState);
    const flowPath = buildFlowPath(snapshot);
    const finalStage = flowPath[flowPath.length - 1] || 'end-day';

    setPlaybackFlowState(snapshot, flowPath.length - 1);
    renderPlaybackStep(finalStage, snapshot);
    await animateFlowPath(flowPath);
    appendPlaybackLog(
      `Day ${snapshot.day}: completed full day (stock ${snapshot.stock}, demand ${snapshot.demand}, fulfilled ${snapshot.fulfilled}, unmet ${snapshot.unmet}).`,
    );

    if (snapshot.done) {
      stopAutoPlayback();
      setPlaybackButtonsEnabled(false);
      appendPlaybackLog('Simulation completed.');
      window.dispatchEvent(new CustomEvent('process-flow-complete'));
    } else {
      setProcess3DStage('start-day');
      setFlowStage('start-day');
      moveTruckToStage('start-day');
    }
  } finally {
    if (!autoPlaybackEnabled && nextBtn) nextBtn.disabled = false;
    playbackStepping = false;
  }
}

async function runNextPlaybackStep() {
  if (!playbackState || playbackStepping) return;
  setActivePlaybackAction('btn-next-day');

  playbackStepping = true;

  const nextBtn = document.getElementById('btn-next-day');
  if (nextBtn) nextBtn.disabled = true;

  try {
    if (!playbackFlowState) {
      const snapshot = stepStorePlaybackDay(playbackState);
      setPlaybackFlowState(snapshot, 1);
      renderPlaybackStep(playbackFlowState.flowPath[playbackFlowState.stageIndex], snapshot);
      appendPlaybackLog(`Day ${snapshot.day}: ${playbackFlowState.flowPath[playbackFlowState.stageIndex].replace(/-/g, ' ')}.`);
      if (snapshot.done) {
        stopAutoPlayback();
        setPlaybackButtonsEnabled(false);
        appendPlaybackLog('Simulation completed.');
        window.dispatchEvent(new CustomEvent('process-flow-complete'));
      }
      return;
    }

    const flowState = playbackFlowState;
    const snapshot = flowState.snapshot;

    if (flowState.stageIndex < flowState.flowPath.length - 1) {
      flowState.stageIndex += 1;
      const stage = flowState.flowPath[flowState.stageIndex];
      renderPlaybackStep(stage, snapshot);
      appendPlaybackLog(`Day ${snapshot.day}: ${stage.replace(/-/g, ' ')}.`);
    } else {
      if (playbackState.done) {
        setPlaybackButtonsEnabled(false);
        appendPlaybackLog('Simulation completed.');
        window.dispatchEvent(new CustomEvent('process-flow-complete'));
        return;
      }

      const nextSnapshot = stepStorePlaybackDay(playbackState);
      setPlaybackFlowState(nextSnapshot, 0);
      renderPlaybackStep(playbackFlowState.flowPath[0], nextSnapshot);
      appendPlaybackLog(`Day ${nextSnapshot.day}: ${playbackFlowState.flowPath[0].replace(/-/g, ' ')}.`);

      if (nextSnapshot.done) {
        setPlaybackButtonsEnabled(false);
        appendPlaybackLog('Simulation completed.');
        window.dispatchEvent(new CustomEvent('process-flow-complete'));
      }
    }
  } finally {
    if (!autoPlaybackEnabled && nextBtn) nextBtn.disabled = false;
    playbackStepping = false;
  }
}

function initPlaybackSimulation() {
  const products = getProducts();
  if (!products.length) {
    alert('Please add at least one product before starting day playback.');
    return;
  }

  const wh = getWarehouseConfig();
  const demand = getDemandConfig();
  const policy = getPolicyConfig();
  const settings = getSimSettings();

  stopAutoPlayback();
  setActivePlaybackAction('btn-init-playback');
  playbackState = createStorePlaybackSimulation({
    products,
    warehouse: new Warehouse(wh),
    demandType: demand.type,
    demandBase: demand.base,
    demandVariance: demand.variance,
    demandExtra: demand.extra,
    policyKey: policy.key,
    policyParams: policy.params,
    days: settings.days,
  });
  playbackBaseStock = Math.max(1, playbackState.stock);

  const log = document.getElementById('playback-log');
  if (log) {
    log.innerHTML = '';
    appendPlaybackLog(`Initialized retail-store day playback for ${products.length} product(s).`);
  }

  setPlaybackButtonsEnabled(true);
  setProcess3DStage('start-day');
  setFlowStage('start-day');
  moveTruckToStage('start-day');
  ensureInventoryRack();
  renderInventoryRack(playbackState.stock);
  renderDemandAndServed(0, 0, 0);
  setPODeliveryStatus('No purchase order for this day yet.');
  renderPlaybackStats({
    day: 0,
    days: settings.days,
    stock: playbackState.stock,
    demand: 0,
    pendingOrders: 0,
    fillRate: 1,
    totalCost: 0,
  });
  updateProcess3DScene({
    stock: playbackState.stock,
    baseStock: playbackBaseStock,
    demand: 0,
    pendingOrders: 0,
    nextReceiptDays: null,
    placedOrderQty: 0,
    receivedQty: 0,
  });
  setPlaybackFlowState({
    day: 0,
    days: settings.days,
    stock: playbackState.stock,
    demand: 0,
    fulfilled: 0,
    unmet: 0,
    pendingOrders: 0,
    nextReceiptDays: null,
    placedOrderQty: 0,
    receivedQty: 0,
    fillRate: 1,
    totalCost: 0,
  }, 0);
  updatePlaybackControlLabels();
  refreshLiveResults();
  setStrategyComparisonLocked(false);
  window.dispatchEvent(new CustomEvent('process-flow-initialized'));
}

function getPlaybackSkipDays() {
  const raw = +(document.getElementById('playback-skip-interval')?.value || 30);
  if (!Number.isFinite(raw) || raw <= 0) return 30;
  return Math.round(raw);
}

function getPlaybackSkipLabel() {
  const select = document.getElementById('playback-skip-interval');
  const selected = select?.options?.[select.selectedIndex];
  return selected?.textContent || 'selected period';
}

async function skipPlaybackPeriod() {
  if (!playbackState || playbackState.done || playbackStepping) return;

  stopAutoPlayback();
  setActivePlaybackAction('btn-skip-period');
  playbackStepping = true;
  setPlaybackButtonsEnabled(false);

  const daysToSkip = getPlaybackSkipDays();
  let skippedDays = 0;
  let snapshot = null;

  while (skippedDays < daysToSkip && playbackState && !playbackState.done) {
    snapshot = stepStorePlaybackDay(playbackState);
    skippedDays++;
  }

  if (!snapshot) {
    playbackStepping = false;
    setPlaybackButtonsEnabled(true);
    return;
  }

  renderPlaybackStats(snapshot);
  renderDemandAndServed(snapshot.demand, snapshot.fulfilled, snapshot.unmet);
  renderInventoryRack(snapshot.stock);
  setPlaybackFlowState(snapshot, buildFlowPath(snapshot).length - 1);
  updateProcess3DScene({
    stock: snapshot.stock,
    baseStock: playbackBaseStock,
    demand: snapshot.demand,
    pendingOrders: snapshot.pendingOrders,
    nextReceiptDays: snapshot.nextReceiptDays,
    placedOrderQty: snapshot.placedOrderQty,
    receivedQty: snapshot.receivedQty,
  });
  // Skip animations during fast-forward - just update state
  const finalStage = buildFlowPath(snapshot)[buildFlowPath(snapshot).length - 1] || 'end-day';
  setProcess3DStage(finalStage);
  setFlowStage(finalStage);
  moveTruckToStage(finalStage);
  refreshLiveResults();

  appendPlaybackLog(
    `Skipped ${skippedDays} day(s) (${getPlaybackSkipLabel()}) to day ${snapshot.day}: stock ${snapshot.stock}, demand ${snapshot.demand}, fulfilled ${snapshot.fulfilled}, unmet ${snapshot.unmet}.`,
  );

  if (snapshot.done) {
    setProcess3DStage('end-day');
    setFlowStage('end-day');
    setPlaybackButtonsEnabled(false);
    appendPlaybackLog('Simulation completed.');
    window.dispatchEvent(new CustomEvent('process-flow-complete'));
  } else {
    setPlaybackButtonsEnabled(true);
  }

  playbackStepping = false;
}

function toggleAutoPlayback() {
  if (!playbackState || playbackState.done) return;

  if (autoPlaybackEnabled) {
    stopAutoPlayback();
    setActivePlaybackAction('btn-next-day');
    const nextBtn = document.getElementById('btn-next-day');
    if (nextBtn) nextBtn.disabled = false;
    return;
  }

  if (playbackStepping) return;

  autoPlaybackEnabled = true;
  setActivePlaybackAction('btn-auto-day');
  const nextBtn = document.getElementById('btn-next-day');
  if (nextBtn) nextBtn.disabled = true;
  updatePlaybackControlLabels();

  const tick = async () => {
    if (!autoPlaybackEnabled || !playbackState || playbackState.done) {
      stopAutoPlayback();
      return;
    }

    await runNextPlaybackDay();

    if (!autoPlaybackEnabled || !playbackState || playbackState.done) {
      stopAutoPlayback();
      return;
    }

    const interval = getPlaybackAdvanceMode() === 'step'
      ? Math.max(40, getPlaybackSpeedMs() - getStepDelayMs())
      : Math.max(80, getPlaybackSpeedMs());
    playbackTimer = setTimeout(tick, interval);
  };

  tick();
}

function handlePlaybackSpeedChange() {
  if (!playbackTimer) return;
  stopAutoPlayback();
  toggleAutoPlayback();
}

function handlePlaybackAdvanceModeChange() {
  stopAutoPlayback();
  updatePlaybackControlLabels();
  playbackFlowState = null;
}

function initProcessLoopWidget() {
  const loop = document.getElementById('flow-process-loop');
  const bar = document.getElementById('flow-process-loop-bar');
  const scene = document.getElementById('process-3d-scene');
  const backdrop = document.getElementById('flow-process-loop-backdrop');
  const expandBtn = document.getElementById('btn-process-loop-expand');
  const closeBtn = document.getElementById('btn-process-loop-close');
  const showBtn = document.getElementById('btn-show-process-loop');
  if (!loop || !bar || !scene || !backdrop || !expandBtn || !closeBtn || !showBtn) return;

  let activePointerId = null;
  let offsetX = 0;
  let offsetY = 0;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let moved = false;
  let suppressClickUntil = 0;
  let previousLeft = '';
  let previousTop = '';
  let previousRight = '';

  const isExpanded = () => loop.classList.contains('expanded');

  const openModal = () => {
    if (isExpanded()) return;
    previousLeft = loop.style.left;
    previousTop = loop.style.top;
    previousRight = loop.style.right;

    // Hard-center modal to avoid residual draggable inline position from skewing layout.
    loop.style.left = '50%';
    loop.style.top = '50%';
    loop.style.right = 'auto';

    loop.classList.add('expanded');
    backdrop.classList.add('active');
    document.body.classList.add('modal-open');
    window.setTimeout(() => resizeProcess3DScene(), 0);
  };

  const closeModal = () => {
    if (!isExpanded()) return;
    loop.classList.remove('expanded');
    backdrop.classList.remove('active');
    document.body.classList.remove('modal-open');
    loop.style.left = previousLeft;
    loop.style.top = previousTop;
    loop.style.right = previousRight;
    clampToViewport();
    window.setTimeout(() => resizeProcess3DScene(), 0);
  };

  const hideWidget = () => {
    closeModal();
    loop.classList.add('loop-hidden');
    showBtn.classList.remove('hidden');
  };

  const showWidget = () => {
    loop.classList.remove('loop-hidden');
    showBtn.classList.add('hidden');
    clampToViewport();
    window.setTimeout(() => resizeProcess3DScene(), 0);
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const clampToViewport = () => {
    if (isExpanded()) return;
    const loopRect = loop.getBoundingClientRect();
    const currentLeft = Number.isFinite(parseFloat(loop.style.left))
      ? parseFloat(loop.style.left)
      : (window.innerWidth - loopRect.width - 16);
    const currentTop = Number.isFinite(parseFloat(loop.style.top))
      ? parseFloat(loop.style.top)
      : 84;
    const nextLeft = clamp(currentLeft, 6, Math.max(6, window.innerWidth - loopRect.width - 6));
    const nextTop = clamp(currentTop, 6, Math.max(6, window.innerHeight - loopRect.height - 6));
    loop.style.left = `${Math.round(nextLeft)}px`;
    loop.style.top = `${Math.round(nextTop)}px`;
    loop.style.right = 'auto';
  };

  const onPointerMove = (e) => {
    if (activePointerId !== e.pointerId || isExpanded()) return;
    const loopRect = loop.getBoundingClientRect();

    const deltaX = Math.abs(e.clientX - pointerStartX);
    const deltaY = Math.abs(e.clientY - pointerStartY);
    if (deltaX > 3 || deltaY > 3) moved = true;

    const nextLeft = clamp(e.clientX - offsetX, 6, Math.max(6, window.innerWidth - loopRect.width - 6));
    const nextTop = clamp(e.clientY - offsetY, 6, Math.max(6, window.innerHeight - loopRect.height - 6));

    loop.style.left = `${Math.round(nextLeft)}px`;
    loop.style.top = `${Math.round(nextTop)}px`;
    loop.style.right = 'auto';
  };

  const onPointerUp = (e) => {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    loop.classList.remove('dragging');
    if (moved) suppressClickUntil = Date.now() + 160;
    moved = false;
  };

  bar.addEventListener('pointerdown', (e) => {
    if (isExpanded()) return;
    if (e.button !== 0) return;
    activePointerId = e.pointerId;
    moved = false;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    const loopRect = loop.getBoundingClientRect();
    offsetX = e.clientX - loopRect.left;
    offsetY = e.clientY - loopRect.top;
    loop.classList.add('dragging');
    bar.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  bar.addEventListener('pointermove', onPointerMove);
  bar.addEventListener('pointerup', onPointerUp);
  bar.addEventListener('pointercancel', onPointerUp);

  scene.addEventListener('click', () => {
    if (Date.now() < suppressClickUntil) return;
    openModal();
  });

  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openModal();
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideWidget();
  });

  showBtn.addEventListener('click', showWidget);

  backdrop.addEventListener('click', closeModal);

  window.addEventListener('resize', () => {
    clampToViewport();
    resizeProcess3DScene();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeModal();
  });

  // Start with animation hidden - user must click "Show Animation" button to view
  hideWidget();
}

export function refreshPlaybackProductOptions() {
  const select = document.getElementById('playback-product');
  if (!select) return;

  const products = getProducts();
  select.innerHTML = '';

  const option = document.createElement('option');
  option.value = 'ALL_PRODUCTS';
  option.textContent = products.length > 0
    ? `All Products (${products.length})`
    : 'All Products (0)';
  option.selected = true;
  select.appendChild(option);
  select.disabled = true;
}

/**
 * Build the simulation summary shown on the Simulate tab.
 */
export function refreshSimSummary() {
  const products = getProducts();
  const wh = getWarehouseConfig();
  const demand = getDemandConfig();
  const policy = getPolicyConfig();
  const settings = getSimSettings();

  const policyLabel = POLICIES[policy.key]?.label || policy.key;

  const el = document.getElementById('sim-summary');
  if (!el) return;
  el.innerHTML = `
    <strong>${products.length}</strong> grocery item(s) in <strong>${wh.name}</strong> (cap: ${wh.capacity})
    &nbsp;|&nbsp; Demand: <strong>${demand.type}</strong> (base: ${demand.base}, σ: ${demand.variance})
    &nbsp;|&nbsp; Policy: <strong>${policyLabel}</strong>
    <br/>
    Duration: <strong>${settings.days} days</strong> &times; <strong>${settings.runs} runs</strong>
    ${extraStrategies.length > 0 ? `&nbsp;|&nbsp; Comparing <strong>${extraStrategies.length + 1}</strong> strategies` : ''}
  `;

  refreshPlaybackProductOptions();
}

/* ---- Strategy comparison builder ---- */
function renderStrategyList() {
  const list = document.getElementById('strategy-list');
  list.innerHTML = '';

  if (extraStrategies.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'item-row';
    empty.innerHTML = '<div><span class="item-meta">No extra strategies yet. Click + Add Strategy to create one.</span></div>';
    list.appendChild(empty);
    return;
  }

  extraStrategies.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'item-row strategy-row';
    row.innerHTML = `
      <div>
        <span class="item-name">${s.label}</span>
        <span class="item-meta"> — ${POLICIES[s.policyKey]?.label || s.policyKey}</span>
      </div>
      <div class="item-actions">
        <button type="button" class="btn-edit" data-idx="${i}" title="Edit">✏️</button>
        <button type="button" class="btn-delete" data-idx="${i}" title="Remove">🗑️</button>
      </div>`;
    row.addEventListener('click', () => openStrategyForm(i));
    list.appendChild(row);
  });

  list.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openStrategyForm(+b.dataset.idx);
    }));

  list.querySelectorAll('.btn-delete').forEach(b =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      extraStrategies.splice(+b.dataset.idx, 1);
      renderStrategyList();
      refreshSimSummary();
      if (playbackState) refreshLiveResults();
    }));
}

function openStrategyForm(idx = -1) {
  if (!playbackState) {
    alert('Initialize Process Flow first to unlock strategy comparison.');
    return;
  }

  editingStrategyIndex = idx;
  openStrategyModal();

  const title = document.getElementById('strategy-form-title');
  const saveBtn = document.getElementById('btn-save-strategy');
  const labelInput = document.getElementById('sf-label');

  if (idx >= 0) {
    const s = extraStrategies[idx];
    if (title) title.textContent = 'Edit Comparison Strategy';
    if (saveBtn) saveBtn.textContent = 'Update';
    if (labelInput) labelInput.value = s.label || '';
    const policySelect = document.getElementById('sf-policy');
    if (policySelect) policySelect.value = s.policyKey;
    renderStrategyPolicyParams();
    const policyFn = POLICIES[s.policyKey];
    if (policyFn && policyFn.defaultParams) {
      for (const [pk, defaultVal] of Object.entries(policyFn.defaultParams)) {
        const el = document.getElementById(`sf-${pk}`);
        if (el) el.value = s.policyParams?.[pk] ?? defaultVal;
      }
    }
  } else {
    if (title) title.textContent = 'Add Comparison Strategy';
    if (saveBtn) saveBtn.textContent = 'Save';
    if (labelInput) labelInput.value = '';
    renderStrategyPolicyParams();
  }

  document.getElementById('sf-label')?.focus();
}

function handleStrategyModalEscape(e) {
  if (e.key !== 'Escape') return;
  const modal = document.getElementById('strategy-form-modal');
  if (modal && !modal.classList.contains('hidden')) closeStrategyForm();
}

function renderStrategyPolicyParams() {
  const key = document.getElementById('sf-policy').value;
  const container = document.getElementById('sf-params');
  const policyFn = POLICIES[key];
  container.innerHTML = '';
  if (!policyFn || !policyFn.defaultParams) return;
  const row = document.createElement('div');
  row.className = 'form-row';
  for (const [pk, defaultVal] of Object.entries(policyFn.defaultParams)) {
    const labelText = policyFn.paramLabels?.[pk] || pk;
    const label = document.createElement('label');
    label.innerHTML = `${labelText} <input id="sf-${pk}" type="number" step="any" value="${defaultVal}" />`;
    row.appendChild(label);
  }
  container.appendChild(row);
}

function saveStrategy() {
  const key = document.getElementById('sf-policy').value;
  const policyFn = POLICIES[key];
  const params = {};
  if (policyFn && policyFn.defaultParams) {
    for (const pk of Object.keys(policyFn.defaultParams)) {
      const el = document.getElementById(`sf-${pk}`);
      if (el) params[pk] = +el.value;
      else params[pk] = policyFn.defaultParams[pk];
    }
  }
  const payload = {
    label: document.getElementById('sf-label').value || `Strategy ${extraStrategies.length + 2}`,
    policyKey: key,
    policyParams: params,
  };

  if (editingStrategyIndex >= 0) {
    extraStrategies[editingStrategyIndex] = payload;
  } else {
    extraStrategies.push(payload);
  }

  closeStrategyForm();
  renderStrategyList();
  refreshSimSummary();
  if (playbackState) refreshLiveResults();
}

function bindStrategyModalEvents() {
  document.getElementById('btn-add-strategy').addEventListener('click', () => openStrategyForm(-1));
  document.getElementById('btn-save-strategy').addEventListener('click', saveStrategy);
  document.getElementById('btn-cancel-strategy').addEventListener('click', closeStrategyForm);
  document.getElementById('strategy-form-backdrop').addEventListener('click', closeStrategyForm);
  document.addEventListener('keydown', handleStrategyModalEscape);
  document.getElementById('sf-policy').addEventListener('change', renderStrategyPolicyParams);
}

export function initDashboard() {
  // Strategy builder
  seedPresetStrategies();
  bindStrategyModalEvents();
  initProcess3DScene();
  initProcessLoopWidget();

  // Day-by-day playback
  document.getElementById('btn-init-playback').addEventListener('click', initPlaybackSimulation);
  document.getElementById('btn-next-day').addEventListener('click', runNextPlaybackDay);
  document.getElementById('btn-auto-day').addEventListener('click', toggleAutoPlayback);
  document.getElementById('btn-skip-period').addEventListener('click', skipPlaybackPeriod);
  document.getElementById('playback-speed').addEventListener('change', handlePlaybackSpeedChange);
  document.getElementById('playback-advance-mode').addEventListener('change', handlePlaybackAdvanceModeChange);

  setPlaybackButtonsEnabled(false);
  setStrategyComparisonLocked(false);
  ensureInventoryRack();
  renderInventoryRack(0);
  renderDemandAndServed(0, 0, 0);
  renderPlaybackStats();
  refreshLiveResults();
  renderStrategyList();
  refreshPlaybackProductOptions();
  updatePlaybackControlLabels();
  setActivePlaybackAction('btn-next-day');
}
