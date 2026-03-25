import tkinter as tk
from tkinter import ttk, messagebox
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import random
import math
from visualization import WorkerVisualization

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

class SimulationEngine:
    def __init__(self, product, warehouse, demand_params, policy_params, days=365):
        self.product = product
        self.warehouse = warehouse
        self.demand_params = demand_params
        self.policy_params = policy_params
        self.days = days
        
        self.history = {
            "days": [], "stock": [], "demand": [], "orders": [],
            "holding_costs": [], "ordering_costs": [], "stockouts": []
        }
        
        self.stock = self.product.initial_stock
        self.pending_orders = [] 
        
        self.cumulative_holding = 0
        self.cumulative_ordering = 0
        self.stockout_count = 0
        
        self.current_demand_base = self.demand_params["base"]
        self.current_day = 0

    def step(self, manual_order_qty=0):
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

    def run(self):
        for _ in range(self.days):
            self.step()

class InvSimApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("InvSim - Inventory Strategy Simulator")
        self.geometry("1000x800")
        
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        self.config_frame = ttk.Frame(self.notebook)
        self.interactive_frame = ttk.Frame(self.notebook)
        self.visualization_frame = ttk.Frame(self.notebook)
        self.results_frame = ttk.Frame(self.notebook)
        
        self.notebook.add(self.config_frame, text="Configure & Simulate")
        self.notebook.add(self.interactive_frame, text="Interactive Play")
        self.notebook.add(self.visualization_frame, text="Worker Visualization")
        self.notebook.add(self.results_frame, text="Results")
        
        self.build_config_ui()
        
    def build_config_ui(self):
        # Product Config
        prod_lf = ttk.LabelFrame(self.config_frame, text="Product Configuration")
        prod_lf.pack(fill=tk.X, padx=10, pady=5)
        
        ttk.Label(prod_lf, text="Initial Stock:").grid(row=0, column=0, padx=5, pady=5)
        self.init_stock_var = tk.IntVar(value=200)
        ttk.Entry(prod_lf, textvariable=self.init_stock_var).grid(row=0, column=1, padx=5, pady=5)
        
        ttk.Label(prod_lf, text="Lead Time (days):").grid(row=0, column=2, padx=5, pady=5)
        self.lead_time_var = tk.IntVar(value=5)
        ttk.Entry(prod_lf, textvariable=self.lead_time_var).grid(row=0, column=3, padx=5, pady=5)
        
        ttk.Label(prod_lf, text="Holding Cost/day:").grid(row=1, column=0, padx=5, pady=5)
        self.holding_cost_var = tk.DoubleVar(value=0.05)
        ttk.Entry(prod_lf, textvariable=self.holding_cost_var).grid(row=1, column=1, padx=5, pady=5)
        
        ttk.Label(prod_lf, text="Ordering Cost:").grid(row=1, column=2, padx=5, pady=5)
        self.ordering_cost_var = tk.DoubleVar(value=50.0)
        ttk.Entry(prod_lf, textvariable=self.ordering_cost_var).grid(row=1, column=3, padx=5, pady=5)
        
        # Demand Config
        dem_lf = ttk.LabelFrame(self.config_frame, text="Demand Pattern")
        dem_lf.pack(fill=tk.X, padx=10, pady=5)
        
        ttk.Label(dem_lf, text="Type:").grid(row=0, column=0, padx=5, pady=5)
        self.dem_type_var = tk.StringVar(value="constant")
        ttk.Combobox(dem_lf, textvariable=self.dem_type_var, values=["constant", "seasonal", "trending", "random-walk"], state="readonly").grid(row=0, column=1, padx=5, pady=5)
        
        ttk.Label(dem_lf, text="Base Demand:").grid(row=0, column=2, padx=5, pady=5)
        self.dem_base_var = tk.DoubleVar(value=30.0)
        ttk.Entry(dem_lf, textvariable=self.dem_base_var).grid(row=0, column=3, padx=5, pady=5)
        
        ttk.Label(dem_lf, text="Variance:").grid(row=1, column=0, padx=5, pady=5)
        self.dem_var_var = tk.DoubleVar(value=5.0)
        ttk.Entry(dem_lf, textvariable=self.dem_var_var).grid(row=1, column=1, padx=5, pady=5)
        
        # Policy Config
        pol_lf = ttk.LabelFrame(self.config_frame, text="Reorder Policy")
        pol_lf.pack(fill=tk.X, padx=10, pady=5)
        
        ttk.Label(pol_lf, text="Type:").grid(row=0, column=0, padx=5, pady=5)
        self.pol_type_var = tk.StringVar(value="human")
        ttk.Combobox(pol_lf, textvariable=self.pol_type_var, values=["human", "rop", "eoq", "jit", "periodic"], state="readonly").grid(row=0, column=1, padx=5, pady=5)
        
        ttk.Label(pol_lf, text="ROP Level / Target:").grid(row=0, column=2, padx=5, pady=5)
        self.pol_rop_var = tk.IntVar(value=100)
        ttk.Entry(pol_lf, textvariable=self.pol_rop_var).grid(row=0, column=3, padx=5, pady=5)
        
        ttk.Label(pol_lf, text="Order Qty:").grid(row=1, column=0, padx=5, pady=5)
        self.pol_qty_var = tk.IntVar(value=150)
        ttk.Entry(pol_lf, textvariable=self.pol_qty_var).grid(row=1, column=1, padx=5, pady=5)

        ttk.Label(pol_lf, text="Review Period (JIT/Per):").grid(row=1, column=2, padx=5, pady=5)
        self.pol_per_var = tk.IntVar(value=7)
        ttk.Entry(pol_lf, textvariable=self.pol_per_var).grid(row=1, column=3, padx=5, pady=5)

        # Sim Config
        sim_lf = ttk.Frame(self.config_frame)
        sim_lf.pack(fill=tk.X, padx=10, pady=20)
        
        ttk.Label(sim_lf, text="Simulation Days:").pack(side=tk.LEFT, padx=5)
        self.sim_days_var = tk.IntVar(value=365)
        ttk.Entry(sim_lf, textvariable=self.sim_days_var, width=10).pack(side=tk.LEFT, padx=5)
        
        ttk.Button(sim_lf, text="Run Simulation", command=self.run_simulation).pack(side=tk.RIGHT, padx=5)
        
    def run_simulation(self):
        try:
            prod = Product("Widget", "W-1", 10.0, self.holding_cost_var.get(), self.ordering_cost_var.get(), self.lead_time_var.get(), self.init_stock_var.get())
            wh = Warehouse("Main", 5000)
            
            dem_params = {
                "type": self.dem_type_var.get(),
                "base": self.dem_base_var.get(),
                "variance": self.dem_var_var.get()
            }
            
            pol_params = {
                "type": self.pol_type_var.get(),
                "reorder_point": self.pol_rop_var.get(),
                "order_qty": self.pol_qty_var.get(),
                "safety_factor": 1.2,
                "buffer_days": 2,
                "review_period": self.pol_per_var.get(),
                "target_level": self.pol_rop_var.get()
            }
            
            self.engine = SimulationEngine(prod, wh, dem_params, pol_params, self.sim_days_var.get())
            
            if pol_params["type"] == "human":
                self.setup_interactive_mode()
                self.notebook.select(self.interactive_frame)
            else:
                self.engine.run()
                self.plot_results(self.engine.history)
                self.notebook.select(self.results_frame)
        except Exception as e:
            messagebox.showerror("Error", f"Failed to run simulation:\n{e}")

    def setup_interactive_mode(self):
        for widget in self.interactive_frame.winfo_children():
            widget.destroy()
            
        self.lbl_day = ttk.Label(self.interactive_frame, text=f"Day: {self.engine.current_day} / {self.engine.days}", font=("Arial", 16, "bold"))
        self.lbl_day.pack(pady=15)
        
        info_frame = ttk.LabelFrame(self.interactive_frame, text="Current Status")
        info_frame.pack(fill=tk.X, padx=20, pady=10)
        
        self.lbl_stock = ttk.Label(info_frame, text=f"Current Stock: {self.engine.stock}", font=("Arial", 14))
        self.lbl_stock.pack(anchor=tk.W, padx=10, pady=5)
        
        self.lbl_demand = ttk.Label(info_frame, text="Yesterday's Demand: N/A", font=("Arial", 12))
        self.lbl_demand.pack(anchor=tk.W, padx=10, pady=5)
        
        self.lbl_pending = ttk.Label(info_frame, text="Pending Orders: None", font=("Arial", 12))
        self.lbl_pending.pack(anchor=tk.W, padx=10, pady=5)
        
        input_frame = ttk.Frame(self.interactive_frame)
        input_frame.pack(fill=tk.X, padx=20, pady=20)
        
        ttk.Label(input_frame, text="Order Quantity:").pack(side=tk.LEFT, padx=5)
        self.manual_order_var = tk.IntVar(value=0)
        ttk.Entry(input_frame, textvariable=self.manual_order_var).pack(side=tk.LEFT, padx=5)
        
        ttk.Button(input_frame, text="Advance Day & Place Order", command=self.advance_interactive).pack(side=tk.LEFT, padx=15)
        ttk.Button(input_frame, text="Skip to End (Auto 0 order)", command=self.skip_to_end).pack(side=tk.LEFT, padx=5)
        
        self.update_interactive_labels()

    def update_interactive_labels(self):
        self.lbl_day.config(text=f"Day: {self.engine.current_day} / {self.engine.days}")
        self.lbl_stock.config(text=f"Current Stock: {self.engine.stock:.1f}")
        
        if self.engine.current_day > 0:
            last_demand = self.engine.history["demand"][-1]
            self.lbl_demand.config(text=f"Yesterday's Demand: {last_demand:.1f}")
            
        pending_strs = [f"{o['qty']} units (Arrives Day {o['arrival_day']})" for o in self.engine.pending_orders]
        self.lbl_pending.config(text=f"Pending Orders: {', '.join(pending_strs) if pending_strs else 'None'}")

    def advance_interactive(self):
        try:
            order_qty = self.manual_order_var.get()
            if order_qty < 0: order_qty = 0
        except ValueError:
            order_qty = 0
            
        self.engine.step(manual_order_qty=order_qty)
        self.manual_order_var.set(0)
        
        if self.engine.current_day >= self.engine.days:
            messagebox.showinfo("Simulation Complete", "You have finished the simulation period!")
            self.plot_results(self.engine.history)
            self.notebook.select(self.results_frame)
        else:
            self.update_interactive_labels()

    def skip_to_end(self):
        while self.engine.current_day < self.engine.days:
            self.engine.step(manual_order_qty=0)
        
        messagebox.showinfo("Simulation Complete", "Skipped to end with 0 units ordered!")
        self.plot_results(self.engine.history)
        self.notebook.select(self.results_frame)
            
    def plot_results(self, history):
        for widget in self.results_frame.winfo_children():
            widget.destroy()
            
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8, 6), sharex=True)
        
        ax1.plot(history["days"], history["stock"], label="Inventory Level", color='blue')
        ax1.set_ylabel("Units")
        ax1.set_title("Inventory Level Over Time")
        ax1.grid(True)
        ax1.legend()
        
        total_costs = [h + o for h, o in zip(history["holding_costs"], history["ordering_costs"])]
        ax2.plot(history["days"], total_costs, label="Total Cost", color='red')
        ax2.plot(history["days"], history["holding_costs"], label="Holding Cost", color='orange', linestyle='--')
        ax2.plot(history["days"], history["ordering_costs"], label="Ordering Cost", color='purple', linestyle='--')
        ax2.set_xlabel("Days")
        ax2.set_ylabel("Cost ($)")
        ax2.set_title("Cumulative Costs")
        ax2.grid(True)
        ax2.legend()
        
        fig.tight_layout()
        
        canvas = FigureCanvasTkAgg(fig, master=self.results_frame)
        canvas.draw()
        canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)

if __name__ == "__main__":
    app = InvSimApp()
    app.mainloop()