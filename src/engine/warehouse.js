/**
 * Warehouse – holds stock for multiple products.
 */
export class Warehouse {
  /**
   * @param {object} opts
   * @param {string}  opts.name
   * @param {number}  opts.capacity  – max total units across all products
   */
  constructor({ name = 'Main Warehouse', capacity = 5000 } = {}) {
    this.name = name;
    this.capacity = capacity;
  }

  /**
   * Current total stock across given product stocks map.
   * @param {Map<string, number>} stockMap – productId → qty
   */
  totalStock(stockMap) {
    let total = 0;
    for (const qty of stockMap.values()) total += qty;
    return total;
  }

  /**
   * Available space given current stock map.
   */
  availableSpace(stockMap) {
    return Math.max(0, this.capacity - this.totalStock(stockMap));
  }
}
