/**
 * Dashboard – orchestrates tabs, simulation summary, strategy comparison builder.
 */

import { getProducts, getWarehouseConfig, getDemandConfig, getPolicyConfig, getSimSettings } from './configPanel.js';
import { POLICIES } from '../engine/policies.js';
import { createPlaybackSimulation, stepPlaybackDay } from '../engine/simulator.js';
import { Warehouse } from '../engine/warehouse.js';

/** @type {Array<{label:string, policyKey:string, policyParams:object}>} */
let extraStrategies = [];
let playbackState = null;
let playbackTimer = null;
let playbackStepping = false;
let autoPlaybackEnabled = false;
let playbackBaseStock = 1;

export function getExtraStrategies() { return extraStrategies; }

function formatCurrency(value) {
  return `$${value.toFixed(2)}`;
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

async function animateFlowPath(path) {
  const delay = getStepDelayMs();
  for (const stage of path) {
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
  const form = document.getElementById('strategy-form');
  if (addBtn) addBtn.disabled = locked;
  if (note) note.classList.toggle('hidden', !locked);
  if (form && locked) form.classList.add('hidden');
}

function animatePOTruck(placedOrderQty, receivedQty) {
  const truck = document.getElementById('po-truck');
  if (!truck) return;

  truck.classList.remove('delivering');
  if (placedOrderQty > 0) {
    void truck.offsetWidth;
    truck.classList.add('delivering');
    setPODeliveryStatus(`Purchase order placed: ${placedOrderQty} units. Truck is delivering.`);
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
      <div class="playback-pill">Total Cost: <strong>$0.00</strong></div>
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
  const autoBtn = document.getElementById('btn-auto-day');
  if (autoBtn) autoBtn.textContent = 'Start Auto Day';
}

function setPlaybackButtonsEnabled(enabled) {
  const nextBtn = document.getElementById('btn-next-day');
  const autoBtn = document.getElementById('btn-auto-day');
  if (nextBtn) nextBtn.disabled = !enabled;
  if (autoBtn) autoBtn.disabled = !enabled;
}

function getSelectedPlaybackProduct() {
  const products = getProducts();
  if (products.length === 0) return null;
  const sku = document.getElementById('playback-product')?.value;
  return products.find((p) => p.sku === sku) || products[0];
}

async function runNextPlaybackDay() {
  if (!playbackState || playbackStepping) return;

  playbackStepping = true;

  const nextBtn = document.getElementById('btn-next-day');
  if (nextBtn) nextBtn.disabled = true;

  const snapshot = stepPlaybackDay(playbackState);
  renderPlaybackStats(snapshot);
  renderDemandAndServed(snapshot.demand, snapshot.fulfilled, snapshot.unmet);
  renderInventoryRack(snapshot.stock);
  animatePOTruck(snapshot.placedOrderQty, snapshot.receivedQty);

  const flowPath = [
    'start-day',
    'daily-sales',
    'check-inventory',
  ];

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

  await animateFlowPath(flowPath);

  appendPlaybackLog(
    `Day ${snapshot.day}: received ${snapshot.receivedQty}, demand ${snapshot.demand}, fulfilled ${snapshot.fulfilled}, unmet ${snapshot.unmet}, order ${snapshot.placedOrderQty}`,
  );

  if (snapshot.done) {
    setFlowStage('end-day');
    stopAutoPlayback();
    setPlaybackButtonsEnabled(false);
    appendPlaybackLog('Simulation completed.');
  } else if (!autoPlaybackEnabled && nextBtn) {
    nextBtn.disabled = false;
  }

  playbackStepping = false;
}

function initPlaybackSimulation() {
  const product = getSelectedPlaybackProduct();
  if (!product) {
    alert('Please add at least one product before starting day playback.');
    return;
  }

  const wh = getWarehouseConfig();
  const demand = getDemandConfig();
  const policy = getPolicyConfig();
  const settings = getSimSettings();

  stopAutoPlayback();
  playbackState = createPlaybackSimulation({
    product,
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
    appendPlaybackLog(`Initialized day-by-day simulation for ${product.name}.`);
  }

  setPlaybackButtonsEnabled(true);
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
  setStrategyComparisonLocked(false);
}

function toggleAutoPlayback() {
  if (!playbackState || playbackState.done || playbackStepping) return;

  const autoBtn = document.getElementById('btn-auto-day');
  if (autoPlaybackEnabled) {
    stopAutoPlayback();
    const nextBtn = document.getElementById('btn-next-day');
    if (nextBtn) nextBtn.disabled = false;
    return;
  }

  autoPlaybackEnabled = true;
  const nextBtn = document.getElementById('btn-next-day');
  if (nextBtn) nextBtn.disabled = true;
  autoBtn.textContent = 'Pause Auto Day';

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

    playbackTimer = setTimeout(tick, Math.max(40, getPlaybackSpeedMs() - getStepDelayMs()));
  };

  tick();
}

function handlePlaybackSpeedChange() {
  if (!playbackTimer) return;
  stopAutoPlayback();
  toggleAutoPlayback();
}

export function refreshPlaybackProductOptions() {
  const select = document.getElementById('playback-product');
  if (!select) return;

  const products = getProducts();
  const current = select.value;
  select.innerHTML = '';

  products.forEach((p, index) => {
    const option = document.createElement('option');
    option.value = p.sku;
    option.textContent = `${p.name} (${p.sku})`;
    if (p.sku === current || (!current && index === 0)) option.selected = true;
    select.appendChild(option);
  });
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
  extraStrategies.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div>
        <span class="item-name">${s.label}</span>
        <span class="item-meta"> — ${POLICIES[s.policyKey]?.label || s.policyKey}</span>
      </div>
      <div class="item-actions">
        <button class="btn-delete" data-idx="${i}" title="Remove">🗑️</button>
      </div>`;
    list.appendChild(row);
  });
  list.querySelectorAll('.btn-delete').forEach(b =>
    b.addEventListener('click', () => { extraStrategies.splice(+b.dataset.idx, 1); renderStrategyList(); refreshSimSummary(); }));
}

function openStrategyForm() {
  if (!playbackState) {
    alert('Initialize Process Flow first to unlock strategy comparison.');
    return;
  }
  document.getElementById('strategy-form').classList.remove('hidden');
  document.getElementById('sf-label').value = '';
  renderStrategyPolicyParams();
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
  extraStrategies.push({
    label: document.getElementById('sf-label').value || `Strategy ${extraStrategies.length + 2}`,
    policyKey: key,
    policyParams: params,
  });
  document.getElementById('strategy-form').classList.add('hidden');
  renderStrategyList();
  refreshSimSummary();
}

export function initDashboard() {
  // Strategy builder
  document.getElementById('btn-add-strategy').addEventListener('click', openStrategyForm);
  document.getElementById('btn-save-strategy').addEventListener('click', saveStrategy);
  document.getElementById('btn-cancel-strategy').addEventListener('click', () =>
    document.getElementById('strategy-form').classList.add('hidden'));
  document.getElementById('sf-policy').addEventListener('change', renderStrategyPolicyParams);

  // Day-by-day playback
  document.getElementById('btn-init-playback').addEventListener('click', initPlaybackSimulation);
  document.getElementById('btn-next-day').addEventListener('click', runNextPlaybackDay);
  document.getElementById('btn-auto-day').addEventListener('click', toggleAutoPlayback);
  document.getElementById('playback-speed').addEventListener('change', handlePlaybackSpeedChange);

  setPlaybackButtonsEnabled(false);
  setStrategyComparisonLocked(true);
  ensureInventoryRack();
  renderInventoryRack(0);
  renderDemandAndServed(0, 0, 0);
  renderPlaybackStats();
  refreshPlaybackProductOptions();
}
