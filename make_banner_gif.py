import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math

# Target size: 728 x 160 (or 720 x 180) - rich wide banner for Discord large image embed
W, H = 728, 160

# Load SwanWings logo
logo_raw = Image.open('c:/Users/pc/Desktop/SwanChanger/swanwings_logo_transparent.png').convert('RGBA')
logo_aspect = logo_raw.width / logo_raw.height
logo_h = 100
logo_w = int(logo_h * logo_aspect)
logo_img = logo_raw.resize((logo_w, logo_h), Image.Resampling.LANCZOS)

# Fonts
font_title = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 38)
font_sub = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 16)
font_badge = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 13)

# Load video for background action
video_path = 'c:/Users/pc/Desktop/SwanChanger/store-site/public/assets/videos/knife-doppler.mp4'
cap = cv2.VideoCapture(video_path)

frames = []
total_frames = 60 # ~3 seconds loop at 20fps

for i in range(total_frames):
    ret, vframe = cap.read()
    if not ret:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ret, vframe = cap.read()
    
    # Convert cv2 frame to PIL
    vframe = cv2.cvtColor(vframe, cv2.COLOR_BGR2RGB)
    vimg = Image.fromarray(vframe)
    
    # Resize and crop to fill banner
    # vimg is 1280x720, we need 728x160
    scale = max(W / vimg.width, H / vimg.height)
    new_w = int(vimg.width * scale)
    new_h = int(vimg.height * scale)
    vimg = vimg.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = (new_w - W) // 2
    top = (new_h - H) // 2
    vimg = vimg.crop((left, top, left + W, top + H))
    
    # Create dark violet / purple atmospheric overlay
    overlay = Image.new('RGBA', (W, H), (7, 6, 12, 190))
    
    # Composite video with dark background
    base = vimg.convert('RGBA')
    base = Image.alpha_composite(base, overlay)
    
    # Add animated neon border & gradient glow
    # Neon hue shifts slightly or sweeps across
    draw = ImageDraw.Draw(base)
    
    # Shimmer sweep position
    progress = (i / total_frames)
    shimmer_x = int(-100 + (W + 200) * progress)
    
    # Gradient overlay for bottom & sides
    for y in range(H):
        alpha = int(120 * (1 - y / H))
        # subtle vignette
    
    # Paste logo on left
    base.alpha_composite(logo_img, (35, (H - logo_h) // 2))
    
    # Draw texts
    # Title: "SWANCHANGER" with purple glow
    text_x = 35 + logo_w + 22
    text_y = 28
    
    # Outer glow for text
    draw.text((text_x + 1, text_y + 1), "SWANCHANGER", font=font_title, fill=(30, 15, 60, 220))
    draw.text((text_x - 1, text_y - 1), "SWANCHANGER", font=font_title, fill=(124, 58, 237, 180))
    draw.text((text_x, text_y), "SWANCHANGER", font=font_title, fill=(245, 240, 255, 255))
    
    # Subtitle: "CS2 SKINCHANGER & GAMEPLAY ASSISTANT"
    sub_y = text_y + 44
    draw.text((text_x, sub_y), "CS2 SKINCHANGER & GAMEPLAY ASSISTANT", font=font_sub, fill=(167, 139, 250, 240))
    
    # Feature Badges: [UNDETECTED] [INSTANT DELIVERY] [1000+ SKINS]
    badge_y = sub_y + 26
    badges = [
        ("⚡ INSTANT ACCESS", (124, 58, 237)),
        ("✨ 1000+ SKINS", (167, 139, 250)),
        ("🛡️ CLEAN & SAFE", (53, 208, 127))
    ]
    
    bx = text_x
    for label, col in badges:
        bbox = font_badge.getbbox(label)
        bw = (bbox[2] - bbox[0]) + 16
        bh = 22
        # draw rounded badge
        draw.rounded_rectangle([bx, badge_y, bx + bw, badge_y + bh], radius=5, fill=(18, 14, 30, 210), outline=col, width=1)
        draw.text((bx + 8, badge_y + 3), label, font=font_badge, fill=(240, 235, 255, 240))
        bx += bw + 10
        
    # Animated neon border around banner
    # Pulsing purple/cyan border
    border_color = (
        int(140 + 50 * math.sin(progress * 2 * math.pi)),
        int(90 + 30 * math.sin(progress * 2 * math.pi)),
        int(240 + 15 * math.sin(progress * 2 * math.pi)),
        230
    )
    draw.rectangle([0, 0, W - 1, H - 1], outline=border_color, width=2)
    
    # Add to frames list
    # Convert to P mode with adaptive palette for crisp small gif
    p_frame = base.convert('RGB').quantize(colors=128, method=Image.Resampling.LANCZOS)
    frames.append(p_frame)

cap.release()

# Save GIF
out_path = 'c:/Users/pc/Desktop/SwanChanger/store-site/public/assets/swanchanger-banner.gif'
frames[0].save(
    out_path,
    save_all=True,
    append_images=frames[1:],
    duration=50, # 20fps -> 50ms
    loop=0,
    optimize=True
)

import os
print('Saved GIF:', out_path, 'Size:', os.path.getsize(out_path), 'bytes')
