/**
 * Reorder Policies — each policy decides *when* and *how much* to order.
 *
 * A policy is a function: (ctx) → orderQty | 0
 * where ctx = { day, stock, product, avgDemand, demandHistory, pendingOrders, params }
 */

/**
 * Fixed Reorder Point (ROP).
 * When stock ≤ reorderPoint, order `orderQty` units.
 */
export function ropPolicy(ctx) {
  const { stock, params, pendingOrders } = ctx;
  const reorderPoint = params.reorderPoint ?? 50;
  const orderQty = params.orderQty ?? 200;

  if (pendingOrders > 0) return 0; // already waiting on an order
  if (stock <= reorderPoint) return orderQty;
  return 0;
}
ropPolicy.label = 'Fixed Reorder Point (ROP)';
ropPolicy.key = 'rop';
ropPolicy.defaultParams = { reorderPoint: 50, orderQty: 200 };
ropPolicy.paramLabels = { reorderPoint: 'Reorder Point (units)', orderQty: 'Order Quantity (units)' };

/**
 * Economic Order Quantity (EOQ).
 * Classic formula: Q* = sqrt(2DS / H)
 * Orders when stock drops below safety stock (leadTime × avgDemand × safetyFactor).
 */
export function eoqPolicy(ctx) {
  const { stock, product, avgDemand, pendingOrders, params } = ctx;
  const safetyFactor = params.safetyFactor ?? 1.5;

  if (pendingOrders > 0) return 0;

  const annualDemand = avgDemand * 365;
  const eoq = Math.ceil(Math.sqrt((2 * annualDemand * product.orderingCost) / (product.holdingCost * 365)));
  const safetyStock = Math.ceil(product.leadTime * avgDemand * safetyFactor);

  if (stock <= safetyStock) return eoq;
  return 0;
}
eoqPolicy.label = 'Economic Order Quantity (EOQ)';
eoqPolicy.key = 'eoq';
eoqPolicy.defaultParams = { safetyFactor: 1.5 };
eoqPolicy.paramLabels = { safetyFactor: 'Safety Factor' };

/**
 * Just-In-Time (JIT).
 * Orders every day to cover forecasted demand for the next lead-time + buffer days.
 */
export function jitPolicy(ctx) {
  const { stock, product, avgDemand, pendingOrders, params } = ctx;
  const bufferDays = params.bufferDays ?? 1;

  const target = Math.ceil(avgDemand * (product.leadTime + bufferDays));
  const totalIncoming = pendingOrders;
  const gap = target - stock - totalIncoming;

  return gap > 0 ? gap : 0;
}
jitPolicy.label = 'Just-In-Time (JIT)';
jitPolicy.key = 'jit';
jitPolicy.defaultParams = { bufferDays: 1 };
jitPolicy.paramLabels = { bufferDays: 'Buffer Days' };

/**
 * Periodic Review.
 * Every `reviewPeriod` days, order up to `targetLevel`.
 */
export function periodicPolicy(ctx) {
  const { day, stock, pendingOrders, params } = ctx;
  const reviewPeriod = params.reviewPeriod ?? 7;
  const targetLevel = params.targetLevel ?? 300;

  if (day % reviewPeriod !== 0) return 0;
  const gap = targetLevel - stock - pendingOrders;
  return gap > 0 ? gap : 0;
}
periodicPolicy.label = 'Periodic Review';
periodicPolicy.key = 'periodic';
periodicPolicy.defaultParams = { reviewPeriod: 7, targetLevel: 300 };
periodicPolicy.paramLabels = { reviewPeriod: 'Review Period (days)', targetLevel: 'Order-Up-To Level (units)' };

/**
 * Registry of all policies by key.
 */
export const POLICIES = {
  rop: ropPolicy,
  eoq: eoqPolicy,
  jit: jitPolicy,
  periodic: periodicPolicy,
};
