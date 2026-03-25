import tkinter as tk
import math

class WorkerVisualization:
    """Warehouse worker visualization using tkinter Canvas"""
    
    def __init__(self, canvas):
        self.canvas = canvas
        self.width = canvas.winfo_width() or 1000
        self.height = canvas.winfo_height() or 700
        
        # Colors
        self.WHITE = "#FFFFFF"
        self.BLACK = "#000000"
        self.SKIN = "#FFC896"
        self.SHIRT = "#3264C8"
        self.PANTS = "#323264"
        self.SHELF_COLOR = "#8B4513"
        self.GRAY = "#808080"
        self.ITEM_COLOR = "#FFA500"
        self.GREEN = "#32C832"
        
    def draw_human(self, x, y, left_arm_angle, right_arm_angle, frame):
        """Draw an animated human figure on canvas"""
        # Head
        self.canvas.create_oval(
            x - 20, y - 20, x + 20, y + 20,
            fill=self.SKIN, outline=self.BLACK, width=2
        )
        
        # Eyes
        self.canvas.create_oval(x - 10, y - 7, x - 4, y - 1, fill=self.BLACK)
        self.canvas.create_oval(x + 4, y - 7, x + 10, y - 1, fill=self.BLACK)
        
        # Body/Torso
        self.canvas.create_rectangle(
            x - 12, y + 20, x + 12, y + 55,
            fill=self.SHIRT, outline=self.BLACK, width=2
        )
        
        # Pants
        self.canvas.create_rectangle(
            x - 12, y + 55, x + 12, y + 85,
            fill=self.PANTS, outline=self.BLACK, width=2
        )
        
        # Left arm
        left_elbow_x = x - 15 + 20 * math.cos(left_arm_angle)
        left_elbow_y = y + 30 + 25 * math.sin(left_arm_angle)
        self.canvas.create_line(
            x - 15, y + 30, left_elbow_x, left_elbow_y,
            fill=self.SKIN, width=5
        )
        self.canvas.create_oval(
            left_elbow_x - 4, left_elbow_y - 4,
            left_elbow_x + 4, left_elbow_y + 4,
            fill=self.SKIN, outline=self.BLACK, width=1
        )
        
        # Right arm
        right_elbow_x = x + 15 + 20 * math.cos(right_arm_angle)
        right_elbow_y = y + 30 + 25 * math.sin(right_arm_angle)
        self.canvas.create_line(
            x + 15, y + 30, right_elbow_x, right_elbow_y,
            fill=self.SKIN, width=5
        )
        self.canvas.create_oval(
            right_elbow_x - 4, right_elbow_y - 4,
            right_elbow_x + 4, right_elbow_y + 4,
            fill=self.SKIN, outline=self.BLACK, width=1
        )
        
        # Left leg
        self.canvas.create_line(
            x - 8, y + 85, x - 8, y + 115,
            fill=self.PANTS, width=5
        )
        self.canvas.create_oval(x - 13, y + 115, x - 3, y + 125, fill=self.BLACK)
        
        # Right leg with walking motion
        right_leg_motion = 5 * math.sin(frame * 0.1)
        self.canvas.create_line(
            x + 8, y + 85, x + 8 + right_leg_motion, y + 115,
            fill=self.PANTS, width=5
        )
        self.canvas.create_oval(
            x + 3 + right_leg_motion, y + 115,
            x + 13 + right_leg_motion, y + 125,
            fill=self.BLACK
        )
    
    def draw_shelves(self):
        """Draw warehouse shelves with items"""
        # Vertical supports
        self.canvas.create_rectangle(100, 200, 120, 450, fill=self.SHELF_COLOR)
        self.canvas.create_rectangle(880, 200, 900, 450, fill=self.SHELF_COLOR)
        
        # Horizontal shelves
        shelf_positions = [250, 350, 450]
        for shelf_y in shelf_positions:
            self.canvas.create_rectangle(100, shelf_y, 900, shelf_y + 15, fill=self.GRAY)
            
            # Add items on shelves
            item_positions = [150, 250, 350, 450, 550, 650, 750]
            for item_x in item_positions:
                self.canvas.create_rectangle(
                    item_x, shelf_y - 30, item_x + 25, shelf_y - 5,
                    fill=self.ITEM_COLOR, outline=self.BLACK, width=2
                )
    
    def get_worker_position(self, frame):
        """Calculate worker position based on frame"""
        start_x = 150
        end_x = 800
        
        progress = (frame % 200) / 200
        if progress < 0.5:
            # Moving right
            x = start_x + (end_x - start_x) * (progress * 2)
        else:
            # Moving left
            x = end_x - (end_x - start_x) * ((progress - 0.5) * 2)
        
        return x
    
    def draw_frame(self, frame, items_picked, day, stock, demand):
        """Draw the complete animation frame"""
        self.canvas.delete("all")
        self.canvas.config(bg=self.WHITE)
        
        # Draw warehouse
        self.draw_shelves()
        
        # Get worker position
        worker_x = self.get_worker_position(frame)
        
        # Calculate arm angles for reaching motion
        if 300 < worker_x < 500:
            reach_progress = abs(worker_x - 400) / 100
            left_arm_angle = math.pi * 0.3 + reach_progress * 0.5
            right_arm_angle = math.pi * 0.3 + reach_progress * 0.5
        else:
            # Walking motion
            left_arm_angle = math.pi * 0.2 + math.sin(frame * 0.08) * 0.3
            right_arm_angle = math.pi * 0.2 - math.sin(frame * 0.08) * 0.3
        
        # Draw worker
        self.draw_human(worker_x, 500, left_arm_angle, right_arm_angle, frame)
        
        # Draw UI text
        self.canvas.create_text(20, 20, text=f"Warehouse Worker Simulation", font=("Arial", 16, "bold"), anchor="nw", fill=self.GREEN)
        self.canvas.create_text(20, 50, text=f"Day: {day}", font=("Arial", 12), anchor="nw", fill=self.BLACK)
        self.canvas.create_text(20, 75, text=f"Current Stock: {stock:.0f} units", font=("Arial", 12), anchor="nw", fill=self.BLACK)
        self.canvas.create_text(20, 100, text=f"Today's Demand: {demand:.0f} units", font=("Arial", 12), anchor="nw", fill=self.BLACK)
        self.canvas.create_text(20, 125, text=f"Items Picked: {items_picked}", font=("Arial", 12), anchor="nw", fill=self.BLACK)
        
        # Instructions
        self.canvas.create_text(20, self.height - 30, text="Visualization syncs with inventory simulation", font=("Arial", 10), anchor="nw", fill=self.GRAY)
        
        self.canvas.update()
