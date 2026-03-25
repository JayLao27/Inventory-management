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

def draw_path(frame):
    start_x = 150
    end_x = 750
    progress = (frame % 200) / 200
    if progress < 0.5:
        x = start_x + (end_x - start_x) * (progress * 2)
    else:
        x = end_x - (end_x - start_x) * ((progress - 0.5) * 2)
    return x


def main():
    running = True
    frame = 0
    paused = False
    items_picked = 0
    human = HumanSprite()
    prev_worker_x = None

    while running:
        dt = clock.tick(60)
        if not paused:
            frame += 1
        human.update(dt)

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_SPACE:
                    paused = not paused
                elif event.key == pygame.K_q:
                    running = False

        # Count items picked every 100 frames
        if not paused and frame % 100 == 0:
            items_picked += 1

        screen.fill(WHITE)
        draw_shelves(screen)

        worker_x = draw_path(frame)
        facing_right = True if prev_worker_x is None else worker_x >= prev_worker_x
        prev_worker_x = worker_x
        reaching = 300 < worker_x < 500
        human.render(screen, worker_x, 520, facing_right=facing_right, reaching=reaching)

        # UI
        status_text = font.render("Warehouse Worker Animation", True, GREEN)
        frame_text = font.render(f"Frame: {frame}", True, BLACK)
        items_text = font.render(f"Items Picked: {items_picked}", True, BLACK)
        screen.blit(status_text, (20, 20))
        screen.blit(frame_text, (20, 60))
        screen.blit(items_text, (20, 100))
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
