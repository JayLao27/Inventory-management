/**
 * ConfigPanel – handles grocery item CRUD, storage, demand, and policy configuration.
 */

import { Product } from '../engine/product.js';
import { generateDemand } from '../engine/demand.js';
import { POLICIES } from '../engine/policies.js';
import { drawSparkline } from '../charts/chartRenderer.js';

/** @type {Product[]} */
let products = [];
let editingIndex = -1;

function openProductModal() {
  document.getElementById('product-form-modal').classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeProductModal() {
  document.getElementById('product-form-modal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  document.getElementById('btn-save-product').textContent = 'Save';
  editingIndex = -1;
}

export function getProducts() { return products; }

export function getWarehouseConfig() {
  return {
    name: document.getElementById('wh-name').value || 'Main Storage',
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
    const categoryLabel = p.category ? `<span class="item-tag">${p.category}</span>` : '';
    row.innerHTML = `
      <div>
        <span class="item-name">${p.name}</span>
        ${categoryLabel}
        <span class="item-meta"> &mdash; ${p.sku} | ₱${p.unitCost}/unit | LT: ${p.leadTime}d | Stock: ${p.initialStock}</span>
      </div>
      <div class="item-actions">
        <button type="button" class="btn-edit" data-idx="${i}" title="Edit">✏️</button>
        <button type="button" class="btn-delete" data-idx="${i}" title="Delete">🗑️</button>
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
  openProductModal();
  editingIndex = idx;
  document.getElementById('product-form-title').textContent = idx >= 0 ? 'Edit Grocery Item' : 'Add Grocery Item';
  document.getElementById('btn-save-product').textContent = idx >= 0 ? 'Update' : 'Save';
  if (idx >= 0) {
    const p = products[idx];
    document.getElementById('pf-name').value = p.name;
    document.getElementById('pf-sku').value = p.sku;
    document.getElementById('pf-category').value = p.category || '';
    document.getElementById('pf-unit-cost').value = p.unitCost;
    document.getElementById('pf-holding-cost').value = p.holdingCost;
    document.getElementById('pf-ordering-cost').value = p.orderingCost;
    document.getElementById('pf-lead-time').value = p.leadTime;
    document.getElementById('pf-initial-stock').value = p.initialStock;
  } else {
    document.getElementById('pf-name').value = '';
    document.getElementById('pf-sku').value = '';
    document.getElementById('pf-category').value = '';
    document.getElementById('pf-unit-cost').value = 10;
    document.getElementById('pf-holding-cost').value = 0.05;
    document.getElementById('pf-ordering-cost').value = 50;
    document.getElementById('pf-lead-time').value = 5;
    document.getElementById('pf-initial-stock').value = 200;
  }

  document.getElementById('pf-name').focus();
}

function saveProduct() {
  const data = {
    name: document.getElementById('pf-name').value || 'Grocery Item',
    sku: document.getElementById('pf-sku').value || 'SKU-001',
    category: document.getElementById('pf-category').value || '',
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
  closeProductModal();
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
  // Grocery item buttons
  document.getElementById('btn-add-product').addEventListener('click', () => openProductForm(-1));
  document.getElementById('btn-save-product').addEventListener('click', saveProduct);
  document.getElementById('btn-cancel-product').addEventListener('click', closeProductModal);
  document.getElementById('product-form-backdrop').addEventListener('click', closeProductModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('product-form-modal').classList.contains('hidden')) {
      closeProductModal();
    }
  });

  // Policy params
  document.getElementById('policy-type').addEventListener('change', () => renderPolicyParams());
  renderPolicyParams();

  // Demand pattern
  document.getElementById('demand-type').addEventListener('change', renderDemandExtraFields);
  document.getElementById('demand-base').addEventListener('input', updateDemandPreview);
  document.getElementById('demand-variance').addEventListener('input', updateDemandPreview);
  renderDemandExtraFields();

  // Seed the catalog with diverse grocery items
  products.push(
    new Product({ name: 'Rice', sku: 'FOOD-RICE-001', category: 'Staple Foods', unitCost: 48, holdingCost: 0.05, orderingCost: 55, leadTime: 4, initialStock: 600 }),
    new Product({ name: 'Canned Corn', sku: 'FOOD-CORN-001', category: 'Canned Goods', unitCost: 25, holdingCost: 0.02, orderingCost: 45, leadTime: 3, initialStock: 400 }),
    new Product({ name: 'Canned Beans', sku: 'FOOD-BEANS-001', category: 'Canned Goods', unitCost: 22, holdingCost: 0.02, orderingCost: 45, leadTime: 3, initialStock: 350 }),
    new Product({ name: 'Canned Tomatoes', sku: 'FOOD-TOMATO-001', category: 'Canned Goods', unitCost: 28, holdingCost: 0.02, orderingCost: 45, leadTime: 3, initialStock: 380 }),
    new Product({ name: 'Milk (1L)', sku: 'DAIRY-MILK-001', category: 'Dairy', unitCost: 65, holdingCost: 0.15, orderingCost: 35, leadTime: 1, initialStock: 200 }),
    new Product({ name: 'Yogurt (500g)', sku: 'DAIRY-YOGURT-001', category: 'Dairy', unitCost: 55, holdingCost: 0.12, orderingCost: 30, leadTime: 1, initialStock: 150 }),
    new Product({ name: 'Cheese (500g)', sku: 'DAIRY-CHEESE-001', category: 'Dairy', unitCost: 220, holdingCost: 0.25, orderingCost: 50, leadTime: 2, initialStock: 80 }),
    new Product({ name: 'Bread (Loaf)', sku: 'BREAD-WHITE-001', category: 'Bread & Bakery', unitCost: 45, holdingCost: 0.20, orderingCost: 25, leadTime: 1, initialStock: 120 }),
    new Product({ name: 'Whole Wheat Flour (2kg)', sku: 'GRAIN-FLOUR-001', category: 'Grains', unitCost: 85, holdingCost: 0.03, orderingCost: 50, leadTime: 5, initialStock: 200 }),
    new Product({ name: 'Oats (1kg)', sku: 'GRAIN-OATS-001', category: 'Grains', unitCost: 120, holdingCost: 0.04, orderingCost: 45, leadTime: 4, initialStock: 150 }),
    new Product({ name: 'Bottled Water (12-pack)', sku: 'BEVERAGE-WATER-001', category: 'Beverages', unitCost: 72, holdingCost: 0.08, orderingCost: 40, leadTime: 2, initialStock: 300 }),
    new Product({ name: 'Orange Juice (2L)', sku: 'BEVERAGE-JUICE-001', category: 'Beverages', unitCost: 95, holdingCost: 0.10, orderingCost: 40, leadTime: 2, initialStock: 180 }),
    new Product({ name: 'Ice Cream (1L)', sku: 'FROZEN-ICECREAM-001', category: 'Frozen', unitCost: 150, holdingCost: 0.30, orderingCost: 50, leadTime: 2, initialStock: 100 })
  );
  renderProductList();
}
