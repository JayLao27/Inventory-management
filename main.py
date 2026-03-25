import math
import random
import sys
import pygame

# ----------------------------
# Core domain classes
# ----------------------------
class Product:
    def __init__(self, name, sku, unit_cost, holding_cost, ordering_cost, lead_time, initial_stock):
        self.name = name
        self.sku = sku
        self.unit_cost = unit_cost
        self.holding_cost = holding_cost
        self.ordering_cost = ordering_cost
        self.lead_time = lead_time
        self.initial_stock = initial_stock

class Warehouse:
    def __init__(self, name, capacity):
        self.name = name
        self.capacity = capacity

# ----------------------------
# Demand generation
# ----------------------------
def generate_demand(day, pattern, base, variance, total_days):
    noise = random.gauss(0, variance)
    if pattern == "constant":
        demand = base + noise
    elif pattern == "seasonal":
        amplitude = base * 0.5
        period = 30
        demand = base + amplitude * math.sin(2 * math.pi * day / period) + noise
    elif pattern == "trending":
        growth_rate = 0.05
        daily_growth = (base * growth_rate) / total_days
        demand = base + (daily_growth * day) + noise
    elif pattern == "random-walk":
        demand = base + noise
    else:
        demand = base + noise
    return max(0, demand)

# ----------------------------
# Simulation Engine
# ----------------------------
class SimulationEngine:
    def __init__(self, product, warehouse, demand_params, policy_params, days=365):
        self.product = product
        self.warehouse = warehouse
        self.demand_params = demand_params
        self.policy_params = policy_params
        self.days = days

        self.history = {
            "days": [],
            "stock": [],
            "demand": [],
            "orders": [],
            "holding_costs": [],
            "ordering_costs": [],
            "stockouts": []
        }

        self.stock = self.product.initial_stock
        self.pending_orders = []
        self.cumulative_holding = 0
        self.cumulative_ordering = 0
        self.stockout_count = 0
        self.current_demand_base = self.demand_params["base"]
        self.current_day = 0

    def step(self, manual_order_qty=0):
        if self.current_day >= self.days:
            return

        self.current_day += 1
        day = self.current_day

        # 1. Process arriving orders
        arrived_qty = 0
        remaining_orders = []
        for order in self.pending_orders:
            if order["arrival_day"] <= day:
                space = self.warehouse.capacity - self.stock
                accepted = min(order["qty"], space)
                self.stock += accepted
                arrived_qty += accepted
            else:
                remaining_orders.append(order)
        self.pending_orders = remaining_orders

        # 2. Generate Demand
        if self.demand_params["type"] == "random-walk":
            self.current_demand_base += random.gauss(0, self.demand_params["variance"])
            self.current_demand_base = max(0, self.current_demand_base)
            demand = self.current_demand_base
        else:
            demand = generate_demand(day, self.demand_params["type"], self.demand_params["base"], self.demand_params["variance"], self.days)

        # 3. Fulfill Demand
        fulfilled = min(self.stock, demand)
        self.stock -= fulfilled
        if demand > fulfilled:
            self.stockout_count += (demand - fulfilled)

        # 4. Calculate costs
        holding_cost_today = self.stock * self.product.holding_cost
        self.cumulative_holding += holding_cost_today

        # 5. Determine Ordering (Policy)
        order_qty = 0
        total_pending = sum(o["qty"] for o in self.pending_orders)
        p_type = self.policy_params["type"]
        avg_demand = self.demand_params["base"]

        if p_type == "human":
            order_qty = manual_order_qty
        elif p_type == "rop":
            if self.stock + total_pending <= self.policy_params["reorder_point"]:
                order_qty = self.policy_params["order_qty"]
        elif p_type == "eoq":
            annual_demand = avg_demand * 365
            if self.product.holding_cost > 0:
                eoq = math.ceil(math.sqrt((2 * annual_demand * self.product.ordering_cost) / (self.product.holding_cost * 365)))
            else:
                eoq = 100
            safety_stock = math.ceil(self.product.lead_time * avg_demand * self.policy_params.get("safety_factor", 1.0))
            if self.stock + total_pending <= safety_stock:
                order_qty = eoq
        elif p_type == "jit":
            target_level = math.ceil(avg_demand * (self.product.lead_time + self.policy_params.get("buffer_days", 2)))
            if total_pending == 0:
                gap = target_level - (self.stock + total_pending)
                if gap > 0:
                    order_qty = gap
        elif p_type == "periodic":
            if day % self.policy_params.get("review_period", 7) == 0:
                gap = self.policy_params.get("target_level", 200) - (self.stock + total_pending)
                if gap > 0:
                    order_qty = gap

        # Place Order
        if order_qty > 0:
            self.pending_orders.append({
                "qty": order_qty,
                "arrival_day": day + self.product.lead_time
            })
            self.cumulative_ordering += self.product.ordering_cost

        # Record history
        self.history["days"].append(day)
        self.history["stock"].append(self.stock)
        self.history["demand"].append(demand)
        self.history["orders"].append(order_qty)
        self.history["holding_costs"].append(self.cumulative_holding)
        self.history["ordering_costs"].append(self.cumulative_ordering)
        self.history["stockouts"].append(self.stockout_count)

# ----------------------------
# Pygame visualization helpers
# ----------------------------
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
SKIN = (255, 200, 150)
SHIRT = (50, 100, 200)
PANTS = (50, 50, 100)
GRAY = (128, 128, 128)
RED = (220, 50, 50)
GREEN = (50, 200, 50)
BLUE = (50, 100, 220)
SHELF_COLOR = (139, 69, 19)
ITEM_COLOR = (255, 165, 0)

def draw_human(surface, x, y, left_arm_angle, right_arm_angle, frame):
    pygame.draw.circle(surface, SKIN, (int(x), int(y)), 20)
    pygame.draw.circle(surface, BLACK, (int(x - 8), int(y - 5)), 3)
    pygame.draw.circle(surface, BLACK, (int(x + 8), int(y - 5)), 3)
    pygame.draw.rect(surface, SHIRT, (int(x - 12), int(y + 20), 24, 35), 0)
    pygame.draw.rect(surface, PANTS, (int(x - 12), int(y + 55), 24, 30), 0)
    left_elbow_x = int(x - 15 + 20 * math.cos(left_arm_angle))
    left_elbow_y = int(y + 30 + 25 * math.sin(left_arm_angle))
    pygame.draw.line(surface, SKIN, (int(x - 15), int(y + 30)), (left_elbow_x, left_elbow_y), 5)
    pygame.draw.circle(surface, SKIN, (left_elbow_x, left_elbow_y), 4)
    right_elbow_x = int(x + 15 + 20 * math.cos(right_arm_angle))
    right_elbow_y = int(y + 30 + 25 * math.sin(right_arm_angle))
    pygame.draw.line(surface, SKIN, (int(x + 15), int(y + 30)), (right_elbow_x, right_elbow_y), 5)
    pygame.draw.circle(surface, SKIN, (right_elbow_x, right_elbow_y), 4)
    pygame.draw.line(surface, PANTS, (int(x - 8), int(y + 85)), (int(x - 8), int(y + 115)), 5)
    pygame.draw.circle(surface, BLACK, (int(x - 8), int(y + 120)), 5)
    right_leg_motion = 5 * math.sin(frame * 0.1)
    pygame.draw.line(surface, PANTS, (int(x + 8), int(y + 85)), (int(x + 8 + right_leg_motion), int(y + 115)), 5)
    pygame.draw.circle(surface, BLACK, (int(x + 8 + right_leg_motion), int(y + 120)), 5)

def draw_shelves(surface):
    pygame.draw.rect(surface, SHELF_COLOR, (100, 200, 20, 250), 0)
    pygame.draw.rect(surface, SHELF_COLOR, (880, 200, 20, 250), 0)
    shelf_positions = [250, 350, 450]
    for shelf_y in shelf_positions:
        pygame.draw.rect(surface, GRAY, (100, shelf_y, 780, 15), 0)
        item_positions = [150, 250, 350, 450, 550, 650, 750]
        for item_x in item_positions:
            pygame.draw.rect(surface, ITEM_COLOR, (item_x, shelf_y - 30, 25, 25), 0)
            pygame.draw.rect(surface, BLACK, (item_x, shelf_y - 30, 25, 25), 2)

def draw_path(frame):
    start_x = 150
    end_x = 750
    progress = (frame % 200) / 200
    if progress < 0.5:
        x = start_x + (end_x - start_x) * (progress * 2)
    else:
        x = end_x - (end_x - start_x) * ((progress - 0.5) * 2)
    return x

def draw_ui(surface, font, small_font, state_text_lines):
    y = 20
    for text, color in state_text_lines:
        surf = font.render(text, True, color)
        surface.blit(surf, (20, y))
        y += 30
    inst = small_font.render("Up/Down adjust order | Enter advances day | S skip to end | Q quit", True, GRAY)
    surface.blit(inst, (20, 660))

# ----------------------------
# Pygame-driven application
# ----------------------------
def main():
    pygame.init()
    WIDTH, HEIGHT = 1000, 700
    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption("Inventory Simulator - Pygame UI")
    clock = pygame.time.Clock()
    font = pygame.font.Font(None, 30)
    small_font = pygame.font.Font(None, 22)

    # Build simulation
    prod = Product("Widget", "W-1", 10.0, 0.05, 50.0, 5, 200)
    wh = Warehouse("Main", 5000)
    dem_params = {"type": "constant", "base": 30.0, "variance": 5.0}
    pol_params = {"type": "human", "reorder_point": 100, "order_qty": 150}
    engine = SimulationEngine(prod, wh, dem_params, pol_params, days=120)

    manual_order_qty = 0
    frame = 0
    running = True

    while running:
        dt = clock.tick(60)
        frame += 1

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_q:
                    running = False
                elif event.key == pygame.K_UP:
                    manual_order_qty += 10
                elif event.key == pygame.K_DOWN:
                    manual_order_qty = max(0, manual_order_qty - 10)
                elif event.key == pygame.K_RETURN:
                    engine.step(manual_order_qty=manual_order_qty)
                    manual_order_qty = 0
                elif event.key == pygame.K_s:
                    while engine.current_day < engine.days:
                        engine.step(manual_order_qty=0)

        screen.fill(WHITE)
        draw_shelves(screen)

        worker_x = draw_path(frame)
        if 300 < worker_x < 500:
            reach_progress = abs(worker_x - 400) / 100
            left_arm_angle = math.pi * 0.3 + reach_progress * 0.5
            right_arm_angle = math.pi * 0.3 + reach_progress * 0.5
        else:
            left_arm_angle = math.pi * 0.2 + math.sin(frame * 0.08) * 0.3
            right_arm_angle = math.pi * 0.2 - math.sin(frame * 0.08) * 0.3
        draw_human(screen, worker_x, 500, left_arm_angle, right_arm_angle, frame)

        last_demand = engine.history["demand"][-1] if engine.history["demand"] else 0
        pending_strs = [f"{o['qty']} (Day {o['arrival_day']})" for o in engine.pending_orders]
        pending_txt = ", ".join(pending_strs) if pending_strs else "None"
        state_lines = [
            (f"Day: {engine.current_day}/{engine.days}", BLACK),
            (f"Stock: {engine.stock:.1f} units", BLACK),
            (f"Last demand: {last_demand:.1f} units", BLACK),
            (f"Pending orders: {pending_txt}", BLACK),
            (f"Manual order queued: {manual_order_qty} units", BLUE),
            (f"Holding cost: ${engine.cumulative_holding:.2f} | Ordering cost: ${engine.cumulative_ordering:.2f}", BLACK),
        ]
        if engine.current_day >= engine.days:
            state_lines.append(("Simulation complete (press Q to exit)", GREEN))

        draw_ui(screen, font, small_font, state_lines)
        pygame.display.flip()

    pygame.quit()
    sys.exit()

if __name__ == "__main__":
    main()
