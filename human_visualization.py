import pygame
import math
import sys

# Initialize Pygame
pygame.init()

# Screen dimensions
WIDTH, HEIGHT = 1000, 700
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("Warehouse Worker Animation - Inventory Management")
clock = pygame.time.Clock()
font = pygame.font.Font(None, 36)

# Colors
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
    """Draw an animated human figure"""
    # Head
    pygame.draw.circle(surface, SKIN, (int(x), int(y)), 20)
    
    # Eyes
    pygame.draw.circle(surface, BLACK, (int(x - 8), int(y - 5)), 3)
    pygame.draw.circle(surface, BLACK, (int(x + 8), int(y - 5)), 3)
    
    # Body/Torso
    pygame.draw.rect(surface, SHIRT, (int(x - 12), int(y + 20), 24, 35), 0)
    
    # Pants
    pygame.draw.rect(surface, PANTS, (int(x - 12), int(y + 55), 24, 30), 0)
    
    # Left arm with angle
    left_elbow_x = int(x - 15 + 20 * math.cos(left_arm_angle))
    left_elbow_y = int(y + 30 + 25 * math.sin(left_arm_angle))
    pygame.draw.line(surface, SKIN, (int(x - 15), int(y + 30)), (left_elbow_x, left_elbow_y), 5)
    
    # Left hand
    pygame.draw.circle(surface, SKIN, (left_elbow_x, left_elbow_y), 4)
    
    # Right arm with angle
    right_elbow_x = int(x + 15 + 20 * math.cos(right_arm_angle))
    right_elbow_y = int(y + 30 + 25 * math.sin(right_arm_angle))
    pygame.draw.line(surface, SKIN, (int(x + 15), int(y + 30)), (right_elbow_x, right_elbow_y), 5)
    
    # Right hand
    pygame.draw.circle(surface, SKIN, (right_elbow_x, right_elbow_y), 4)
    
    # Left leg
    pygame.draw.line(surface, PANTS, (int(x - 8), int(y + 85)), (int(x - 8), int(y + 115)), 5)
    # Left foot
    pygame.draw.circle(surface, BLACK, (int(x - 8), int(y + 120)), 5)
    
    # Right leg with walking motion
    right_leg_motion = 5 * math.sin(frame * 0.1)
    pygame.draw.line(surface, PANTS, (int(x + 8), int(y + 85)), (int(x + 8 + right_leg_motion), int(y + 115)), 5)
    # Right foot
    pygame.draw.circle(surface, BLACK, (int(x + 8 + right_leg_motion), int(y + 120)), 5)

def draw_shelves(surface):
    """Draw warehouse shelves with items"""
    # Vertical supports
    pygame.draw.rect(surface, SHELF_COLOR, (100, 200, 20, 250), 0)
    pygame.draw.rect(surface, SHELF_COLOR, (800, 200, 20, 250), 0)
    
    # Horizontal shelves
    shelf_positions = [250, 350, 450]
    for shelf_y in shelf_positions:
        pygame.draw.rect(surface, GRAY, (100, shelf_y, 720, 15), 0)
        
        # Add items on shelves
        item_positions = [150, 250, 350, 450, 550, 650, 750]
        for item_x in item_positions:
            pygame.draw.rect(surface, ITEM_COLOR, (item_x, shelf_y - 30, 25, 25), 0)
            pygame.draw.rect(surface, BLACK, (item_x, shelf_y - 30, 25, 25), 2)

def draw_path(surface, frame):
    """Draw the path the worker takes"""
    # Start position
    start_x = 150
    end_x = 750
    
    # Calculate position based on frame
    progress = (frame % 200) / 200
    if progress < 0.5:
        # Moving right
        x = start_x + (end_x - start_x) * (progress * 2)
    else:
        # Moving left
        x = end_x - (end_x - start_x) * ((progress - 0.5) * 2)
    
    return x

def draw_ui(surface, frame, items_picked):
    """Draw UI information"""
    frame_text = font.render(f"Frame: {frame}", True, BLACK)
    items_text = font.render(f"Items Picked: {items_picked}", True, BLACK)
    status_text = font.render("Warehouse Worker Animation", True, GREEN)
    
    surface.blit(status_text, (20, 20))
    surface.blit(frame_text, (20, 60))
    surface.blit(items_text, (20, 100))
    
    # Instructions
    small_font = pygame.font.Font(None, 24)
    inst_text = small_font.render("Press SPACE to pause | Q to quit", True, GRAY)
    surface.blit(inst_text, (20, HEIGHT - 40))

def main():
    running = True
    frame = 0
    paused = False
    items_picked = 0
    
    while running:
        clock.tick(60)  # 60 FPS
        
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_SPACE:
                    paused = not paused
                elif event.key == pygame.K_q:
                    running = False
        
        # Update frame
        if not paused:
            frame += 1
            # Count items picked every 100 frames
            if frame % 100 == 0:
                items_picked += 1
        
        # Clear screen
        screen.fill(WHITE)
        
        # Draw warehouse
        draw_shelves(screen)
        
        # Get worker position
        worker_x = draw_path(screen, frame)
        
        # Calculate arm angles for reaching motion
        # When worker approaches shelf (x between 300-500), arms reach up
        if 300 < worker_x < 500:
            reach_progress = abs(worker_x - 400) / 100
            left_arm_angle = math.pi * 0.3 + reach_progress * 0.5
            right_arm_angle = math.pi * 0.3 + reach_progress * 0.5
        else:
            # Walking motion
            left_arm_angle = math.pi * 0.2 + math.sin(frame * 0.08) * 0.3
            right_arm_angle = math.pi * 0.2 - math.sin(frame * 0.08) * 0.3
        
        # Draw worker
        draw_human(screen, worker_x, 500, left_arm_angle, right_arm_angle, frame)
        
        # Draw UI
        draw_ui(screen, frame, items_picked)
        
        # Draw pause indicator
        if paused:
            pause_text = font.render("PAUSED", True, RED)
            screen.blit(pause_text, (WIDTH // 2 - 50, 20))
        
        pygame.display.flip()
    
    pygame.quit()
    sys.exit()

if __name__ == "__main__":
    main()
