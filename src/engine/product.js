/**
 * Product – represents a single SKU in the simulation.
 */
export class Product {
  /**
   * @param {object} opts
   * @param {string}  opts.name
   * @param {string}  opts.sku
   * @param {number}  opts.unitCost       – purchase price per unit
   * @param {number}  opts.holdingCost    – cost to hold 1 unit for 1 day
   * @param {number}  opts.orderingCost   – fixed cost per order placed
   * @param {number}  opts.leadTime       – days between order and delivery
   * @param {number}  opts.initialStock
   */
  constructor({ name, sku, unitCost = 10, holdingCost = 0.05, orderingCost = 50, leadTime = 5, initialStock = 200 }) {
    this.id = crypto.randomUUID();
    this.name = name;
    this.sku = sku;
    this.unitCost = unitCost;
    this.holdingCost = holdingCost;
    this.orderingCost = orderingCost;
    this.leadTime = leadTime;
    this.initialStock = initialStock;
  }

  clone() {
    return new Product({ ...this });
  }
}
