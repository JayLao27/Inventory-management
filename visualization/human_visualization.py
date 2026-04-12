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
font = pygame.font.Font(None, 32)
small_font = pygame.font.Font(None, 22)

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
FLOOR_TOP = (220, 224, 230)
FLOOR_BOTTOM = (200, 206, 214)
BG_TOP = (245, 248, 252)
BG_BOTTOM = (226, 233, 242)

# ------------------------------------------------------------------
# Human sprite (no external assets)
# ------------------------------------------------------------------

def build_sprite_frames():
    """Prebuild walking and reaching frames on Surfaces for a more realistic look."""
    frames = []
    for i in range(8):
        surf = pygame.Surface((80, 140), pygame.SRCALPHA)

        # Body proportions
        cx, cy = 40, 60
        sway = math.sin(i / 8 * math.tau) * 4
        leg_angle = math.sin(i / 8 * math.tau)
        arm_angle = math.sin(i / 8 * math.tau + math.pi)

        # Shoes
        pygame.draw.ellipse(surf, (30, 30, 35), (18 + sway, 116, 18, 10))
        pygame.draw.ellipse(surf, (30, 30, 35), (44 + sway, 116, 18, 10))

        # Pants
        pygame.draw.rect(surf, (45, 60, 110), (28 + sway, 80, 24, 36), border_radius=6)

        # Torso with vest highlight
        pygame.draw.rect(surf, (35, 90, 190), (24 + sway, 44, 32, 40), border_radius=6)
        pygame.draw.rect(surf, (250, 190, 60), (24 + sway + 10, 44, 12, 40), border_radius=4)

        # Head with hard hat
        pygame.draw.circle(surf, (250, 210, 180), (int(cx + sway), 30), 16)
        pygame.draw.ellipse(surf, (240, 200, 60), (int(cx + sway - 18), 12, 36, 12))

        # Arms (swing)
        arm_len = 26
        upper_arm_dx = arm_len * 0.6 * math.sin(arm_angle)
        upper_arm_dy = arm_len * 0.6 * math.cos(arm_angle)
        pygame.draw.line(
            surf,
            (250, 210, 180),
            (int(cx + sway - 12), 52),
            (int(cx + sway - 12 + upper_arm_dx), int(52 + upper_arm_dy)),
            6,
        )
        pygame.draw.line(
            surf,
            (250, 210, 180),
            (int(cx + sway + 12), 52),
            (int(cx + sway + 12 - upper_arm_dx), int(52 - upper_arm_dy)),
            6,
        )

        # Legs (swing)
        leg_len = 30
        leg_dx = leg_len * 0.5 * math.sin(leg_angle)
        leg_dy = leg_len * math.cos(leg_angle)
        pygame.draw.line(
            surf,
            (45, 60, 110),
            (int(cx + sway - 6), 92),
            (int(cx + sway - 6 + leg_dx), int(92 + leg_dy)),
            6,
        )
        pygame.draw.line(
            surf,
            (45, 60, 110),
            (int(cx + sway + 6), 92),
            (int(cx + sway + 6 - leg_dx), int(92 + leg_dy)),
            6,
        )

        frames.append(surf)

    # Reaching frame (arms up)
    reach = pygame.Surface((80, 140), pygame.SRCALPHA)
    sway = 0
    cx = 40
    pygame.draw.ellipse(reach, (30, 30, 35), (18 + sway, 116, 18, 10))
    pygame.draw.ellipse(reach, (30, 30, 35), (44 + sway, 116, 18, 10))
    pygame.draw.rect(reach, (45, 60, 110), (28 + sway, 80, 24, 36), border_radius=6)
    pygame.draw.rect(reach, (35, 90, 190), (24 + sway, 44, 32, 40), border_radius=6)
    pygame.draw.rect(reach, (250, 190, 60), (24 + sway + 10, 44, 12, 40), border_radius=4)
    pygame.draw.circle(reach, (250, 210, 180), (int(cx + sway), 30), 16)
    pygame.draw.ellipse(reach, (240, 200, 60), (int(cx + sway - 18), 12, 36, 12))
    pygame.draw.line(reach, (250, 210, 180), (int(cx + sway - 12), 52), (int(cx + sway - 20), 12), 6)
    pygame.draw.line(reach, (250, 210, 180), (int(cx + sway + 12), 52), (int(cx + sway + 20), 12), 6)
    frames.append(reach)
    return frames

class HumanSprite:
    def __init__(self):
        self.frames = build_sprite_frames()
        self.walk_frames = self.frames[:-1]
        self.reach_frame = self.frames[-1]
        self.index = 0
        self.timer = 0
        self.frame_time = 110  # ms per frame

    def update(self, dt):
        self.timer += dt
        if self.timer >= self.frame_time:
            self.timer = 0
            self.index = (self.index + 1) % len(self.walk_frames)

    def render(self, surface, x, y, facing_right=True, reaching=False):
        frame = self.reach_frame if reaching else self.walk_frames[self.index]
        if not facing_right:
            frame = pygame.transform.flip(frame, True, False)
        rect = frame.get_rect(center=(int(x), int(y)))
        surface.blit(frame, rect)

# ------------------------------------------------------------------
# Scene helpers
# ------------------------------------------------------------------

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

def draw_background(surface):
    """Render a subtle vertical gradient and warehouse floor."""
    for y in range(HEIGHT):
        t = y / max(1, HEIGHT - 1)
        color = (
            int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
            int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
            int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
        )
        pygame.draw.line(surface, color, (0, y), (WIDTH, y))

    floor_y = 560
    floor_height = HEIGHT - floor_y
    for i in range(floor_height):
        t = i / max(1, floor_height - 1)
        color = (
            int(FLOOR_TOP[0] + (FLOOR_BOTTOM[0] - FLOOR_TOP[0]) * t),
            int(FLOOR_TOP[1] + (FLOOR_BOTTOM[1] - FLOOR_TOP[1]) * t),
            int(FLOOR_TOP[2] + (FLOOR_BOTTOM[2] - FLOOR_TOP[2]) * t),
        )
        pygame.draw.line(surface, color, (0, floor_y + i), (WIDTH, floor_y + i))

    pygame.draw.line(surface, (165, 172, 182), (0, floor_y), (WIDTH, floor_y), 2)


def draw_pick_flash(surface, x, y, timer_ms):
    """Short-lived pickup sparkle feedback."""
    if timer_ms <= 0:
        return
    alpha = max(0, min(255, int(255 * (timer_ms / 280))))
    spark = pygame.Surface((40, 40), pygame.SRCALPHA)
    color = (255, 215, 90, alpha)
    pygame.draw.line(spark, color, (20, 4), (20, 36), 3)
    pygame.draw.line(spark, color, (4, 20), (36, 20), 3)
    pygame.draw.line(spark, color, (8, 8), (32, 32), 2)
    pygame.draw.line(spark, color, (32, 8), (8, 32), 2)
    surface.blit(spark, (int(x - 20), int(y - 20)))


def main():
    running = True
    frame = 0
    paused = False
    items_picked = 0
    human = HumanSprite()
    start_x = 150
    end_x = 750
    worker_x = float(start_x)
    worker_dir = 1
    speed_px_per_sec = 190.0
    pick_points = [250, 350, 450, 550, 650]
    pick_cooldown_ms = 0
    pick_timer_ms = 0
    pick_flash_ms = 0
    reached_at = None

    while running:
        dt = clock.tick(60)
        dt_sec = dt / 1000.0
        if not paused:
            frame += 1

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_SPACE:
                    paused = not paused
                elif event.key == pygame.K_q:
                    running = False

        if not paused:
            if pick_cooldown_ms > 0:
                pick_cooldown_ms = max(0, pick_cooldown_ms - dt)
            if pick_flash_ms > 0:
                pick_flash_ms = max(0, pick_flash_ms - dt)

            is_picking = pick_timer_ms > 0
            if is_picking:
                pick_timer_ms = max(0, pick_timer_ms - dt)
                human.update(max(16, dt // 3))
                if pick_timer_ms == 0:
                    items_picked += 1
                    pick_flash_ms = 280
                    pick_cooldown_ms = 500
            else:
                next_x = worker_x + worker_dir * speed_px_per_sec * dt_sec
                if next_x <= start_x:
                    worker_x = float(start_x)
                    worker_dir = 1
                elif next_x >= end_x:
                    worker_x = float(end_x)
                    worker_dir = -1
                else:
                    worker_x = next_x

                human.update(dt)

                if pick_cooldown_ms == 0:
                    for point in pick_points:
                        if abs(worker_x - point) < 6:
                            pick_timer_ms = 600
                            reached_at = point
                            break

        draw_background(screen)
        draw_shelves(screen)

        facing_right = worker_dir >= 0
        reaching = pick_timer_ms > 0
        bob = math.sin(frame * 0.34) * 2.5 if not reaching else 0

        shadow_w = 46 if reaching else 38
        pygame.draw.ellipse(screen, (70, 70, 80, 70), (int(worker_x - shadow_w // 2), 548, shadow_w, 14))
        human.render(screen, worker_x, 520 + bob, facing_right=facing_right, reaching=reaching)

        if reaching:
            box_x = worker_x + (36 if facing_right else -58)
            pygame.draw.rect(screen, (205, 150, 80), (int(box_x), 468, 26, 22), border_radius=3)
            pygame.draw.rect(screen, (120, 80, 40), (int(box_x), 468, 26, 22), 2, border_radius=3)

        if pick_flash_ms > 0 and reached_at is not None:
            draw_pick_flash(screen, reached_at, 315, pick_flash_ms)

        # UI
        status_text = font.render("Warehouse Worker Animation", True, GREEN)
        frame_text = font.render(f"Frame: {frame}", True, BLACK)
        items_text = font.render(f"Items Picked: {items_picked}", True, BLACK)
        mode = "Picking" if reaching else ("Paused" if paused else "Walking")
        mode_text = small_font.render(f"State: {mode}", True, BLUE)
        screen.blit(status_text, (20, 20))
        screen.blit(frame_text, (20, 60))
        screen.blit(items_text, (20, 100))
        screen.blit(mode_text, (20, 136))
        inst_text = small_font.render("SPACE pause | Q quit", True, GRAY)
        screen.blit(inst_text, (20, HEIGHT - 40))

        if paused:
            pause_text = font.render("PAUSED", True, RED)
            screen.blit(pause_text, (WIDTH // 2 - 60, 20))

        pygame.display.flip()

    pygame.quit()
    sys.exit()

if __name__ == "__main__":
    main()
