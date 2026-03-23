/**
 * ConfigPanel – handles product CRUD, warehouse, demand, and policy configuration.
 */

import { Product } from '../engine/product.js';
import { generateDemand } from '../engine/demand.js';
import { POLICIES } from '../engine/policies.js';
import { drawSparkline } from '../charts/chartRenderer.js';

/** @type {Product[]} */
let products = [];
let editingIndex = -1;

export function getProducts() { return products; }

export function getWarehouseConfig() {
  return {
    name: document.getElementById('wh-name').value || 'Main Warehouse',
    capacity: +(document.getElementById('wh-capacity').value) || 5000,
  };
}

export function getDemandConfig() {
  const type = document.getElementById('demand-type').value;
  const base = +(document.getElementById('demand-base').value) || 30;
  const variance = +(document.getElementById('demand-variance').value) || 5;
  const extra = {};
  const ampEl = document.getElementById('demand-amplitude');
  const periodEl = document.getElementById('demand-period');
  const growthEl = document.getElementById('demand-growth');
  if (ampEl) extra.amplitude = +ampEl.value;
  if (periodEl) extra.period = +periodEl.value;
  if (growthEl) extra.growthRate = +growthEl.value;
  return { type, base, variance, extra };
}

export function getPolicyConfig() {
  const key = document.getElementById('policy-type').value;
  const params = {};
  const policyFn = POLICIES[key];
  if (policyFn && policyFn.defaultParams) {
    for (const pk of Object.keys(policyFn.defaultParams)) {
      const el = document.getElementById(`policy-${pk}`);
      if (el) params[pk] = +el.value;
      else params[pk] = policyFn.defaultParams[pk];
    }
  }
  return { key, params };
}

export function getSimSettings() {
  return {
    days: +(document.getElementById('sim-duration').value) || 180,
    runs: +(document.getElementById('sim-runs').value) || 50,
  };
}

/* ---- Render product list ---- */
function renderProductList() {
  const list = document.getElementById('product-list');
  list.innerHTML = '';
  products.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div>
        <span class="item-name">${p.name}</span>
        <span class="item-meta"> &mdash; ${p.sku} | $${p.unitCost}/unit | LT: ${p.leadTime}d | Stock: ${p.initialStock}</span>
      </div>
      <div class="item-actions">
        <button class="btn-edit" data-idx="${i}" title="Edit">✏️</button>
        <button class="btn-delete" data-idx="${i}" title="Delete">🗑️</button>
      </div>`;
    list.appendChild(row);
  });

  // bind
  list.querySelectorAll('.btn-edit').forEach(b =>
    b.addEventListener('click', () => openProductForm(+b.dataset.idx)));
  list.querySelectorAll('.btn-delete').forEach(b =>
    b.addEventListener('click', () => { products.splice(+b.dataset.idx, 1); renderProductList(); }));
}

function openProductForm(idx = -1) {
  const form = document.getElementById('product-form');
  form.classList.remove('hidden');
  editingIndex = idx;
  document.getElementById('product-form-title').textContent = idx >= 0 ? 'Edit Product' : 'Add Product';
  if (idx >= 0) {
    const p = products[idx];
    document.getElementById('pf-name').value = p.name;
    document.getElementById('pf-sku').value = p.sku;
    document.getElementById('pf-unit-cost').value = p.unitCost;
    document.getElementById('pf-holding-cost').value = p.holdingCost;
    document.getElementById('pf-ordering-cost').value = p.orderingCost;
    document.getElementById('pf-lead-time').value = p.leadTime;
    document.getElementById('pf-initial-stock').value = p.initialStock;
  } else {
    document.getElementById('pf-name').value = '';
    document.getElementById('pf-sku').value = '';
    document.getElementById('pf-unit-cost').value = 10;
    document.getElementById('pf-holding-cost').value = 0.05;
    document.getElementById('pf-ordering-cost').value = 50;
    document.getElementById('pf-lead-time').value = 5;
    document.getElementById('pf-initial-stock').value = 200;
  }
}

function saveProduct() {
  const data = {
    name: document.getElementById('pf-name').value || 'Product',
    sku: document.getElementById('pf-sku').value || 'SKU-001',
    unitCost: +(document.getElementById('pf-unit-cost').value),
    holdingCost: +(document.getElementById('pf-holding-cost').value),
    orderingCost: +(document.getElementById('pf-ordering-cost').value),
    leadTime: +(document.getElementById('pf-lead-time').value),
    initialStock: +(document.getElementById('pf-initial-stock').value),
  };
  if (editingIndex >= 0) {
    Object.assign(products[editingIndex], data);
  } else {
    products.push(new Product(data));
  }
  document.getElementById('product-form').classList.add('hidden');
  editingIndex = -1;
  renderProductList();
}

/* ---- Dynamic Policy Params ---- */
function renderPolicyParams(selectId = 'policy-type', containerId = 'policy-params') {
  const key = document.getElementById(selectId).value;
  const container = document.getElementById(containerId);
  const policyFn = POLICIES[key];
  container.innerHTML = '';
  if (!policyFn || !policyFn.defaultParams) return;
  const row = document.createElement('div');
  row.className = 'form-row';
  for (const [pk, defaultVal] of Object.entries(policyFn.defaultParams)) {
    const label = document.createElement('label');
    const labelText = policyFn.paramLabels?.[pk] || pk;
    label.innerHTML = `${labelText} <input id="${containerId === 'policy-params' ? 'policy-' : 'sf-'}${pk}" type="number" step="any" value="${defaultVal}" />`;
    row.appendChild(label);
  }
  container.appendChild(row);
}

/* ---- Demand Extra Fields ---- */
function renderDemandExtraFields() {
  const type = document.getElementById('demand-type').value;
  const container = document.getElementById('demand-extra-fields');
  container.innerHTML = '';
  if (type === 'seasonal') {
    container.innerHTML = `
      <div class="form-row">
        <label>Amplitude <input id="demand-amplitude" type="number" min="0" value="12" /></label>
        <label>Period (days) <input id="demand-period" type="number" min="7" value="90" /></label>
      </div>`;
  } else if (type === 'trending') {
    container.innerHTML = `
      <label>Growth Rate (0-1) <input id="demand-growth" type="number" min="0" max="2" step="0.01" value="0.15" /></label>`;
  }
  // rebind for preview update
  container.querySelectorAll('input').forEach(input =>
    input.addEventListener('input', updateDemandPreview));
  updateDemandPreview();
}

function updateDemandPreview() {
  const { type, base, variance, extra } = getDemandConfig();
  const previewData = generateDemand(type, 90, base, variance, extra);
  const canvas = document.getElementById('demand-preview');
  if (canvas) drawSparkline(canvas, previewData);
}

/* ---- Init ---- */
export function initConfigPanel() {
  // Product buttons
  document.getElementById('btn-add-product').addEventListener('click', () => openProductForm(-1));
  document.getElementById('btn-save-product').addEventListener('click', saveProduct);
  document.getElementById('btn-cancel-product').addEventListener('click', () => {
    document.getElementById('product-form').classList.add('hidden');
    editingIndex = -1;
  });

  // Policy params
  document.getElementById('policy-type').addEventListener('change', () => renderPolicyParams());
  renderPolicyParams();

  // Demand pattern
  document.getElementById('demand-type').addEventListener('change', renderDemandExtraFields);
  document.getElementById('demand-base').addEventListener('input', updateDemandPreview);
  document.getElementById('demand-variance').addEventListener('input', updateDemandPreview);
  renderDemandExtraFields();

  // Add two sample products
  products.push(new Product({ name: 'Widget A', sku: 'WA-001', unitCost: 12, holdingCost: 0.04, orderingCost: 45, leadTime: 4, initialStock: 250 }));
  products.push(new Product({ name: 'Gadget B', sku: 'GB-002', unitCost: 28, holdingCost: 0.08, orderingCost: 60, leadTime: 7, initialStock: 150 }));
  renderProductList();
}
