/**
 * Dashboard – orchestrates tabs, simulation summary, strategy comparison builder.
 */

import { getProducts, getWarehouseConfig, getDemandConfig, getPolicyConfig, getSimSettings } from './configPanel.js';
import { POLICIES } from '../engine/policies.js';

/** @type {Array<{label:string, policyKey:string, policyParams:object}>} */
let extraStrategies = [];

export function getExtraStrategies() { return extraStrategies; }

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
    <strong>${products.length}</strong> product(s) in <strong>${wh.name}</strong> (cap: ${wh.capacity})
    &nbsp;|&nbsp; Demand: <strong>${demand.type}</strong> (base: ${demand.base}, σ: ${demand.variance})
    &nbsp;|&nbsp; Policy: <strong>${policyLabel}</strong>
    <br/>
    Duration: <strong>${settings.days} days</strong> &times; <strong>${settings.runs} runs</strong>
    ${extraStrategies.length > 0 ? `&nbsp;|&nbsp; Comparing <strong>${extraStrategies.length + 1}</strong> strategies` : ''}
  `;
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
}
