import re

with open("c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html", "r", encoding="utf-8") as f:
    text = f.read()

lines = text.split('\n')

# The armory section is OUTSIDE the .wrap div. It goes full width.
# armory-inner.lobby-wrap has our custom max-width: 1400px + margin-inline: auto
# BUT the weapon-stage at <=760px sets grid-template-columns:minmax(0,1fr) which is single column.
# Check user's screen width - from the screenshot, it looks like a wide desktop.
# 
# Real problem: Look at all media queries containing weapon-stage grid changes

print("=== ALL MEDIA QUERIES WITH weapon-stage grid ===")
# Find @media blocks that contain weapon-stage grid rules
media_blocks = re.findall(r'@media[^{]*\{[^}]*weapon-stage[^}]*grid-template[^}]*\}', text)
for mb in media_blocks:
    print(mb[:200])
    print("---")

# Also check: does the cascade order matter?
# Line 430: .armory .weapon-stage{grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr)} (default 2-col)
# Line 499: @media (width<=1100px) .armory .weapon-stage{...85/1.15}
# Line 512: .armory .weapon-stage{grid-template-columns:minmax(0,1fr)} (single col at <=760px)
# Our custom: @media (min-width:981px) .armory .weapon-stage{...0.95/1.05}

# The issue might be that line 512 (<=760px media) is AFTER our custom rule.
# But if user is on desktop, <=760px shouldn't apply.

# Let's check: is the user's layout actually single-column?
# From the screenshot, YES - the text "CS2 icin kullanisli bir skin changer" is at the top left,
# the weapon is below it, then the skin selector grid below that. This IS single column layout.
# This means either <=760px is matching or there's a cascade problem.

# Let me check: at what breakpoint does the grid go single column?
print("\n=== Looking for where single-column weapon-stage is set ===")
for i, line in enumerate(lines):
    if 'weapon-stage' in line and '1fr' in line and 'grid' in line:
        # Look backwards for the nearest @media
        for j in range(i, max(0, i-5), -1):
            if '@media' in lines[j]:
                print(f"Line {j+1}: {lines[j].strip()[:120]}")
                break
        print(f"  Line {i+1}: {line.strip()[:150]}")
        print()

# Also check if there's a prefers-reduced-motion block that applies
print("\n=== reduced-motion blocks ===")
for i, line in enumerate(lines):
    if 'reduced-motion' in line:
        print(f"Line {i+1}: {line.strip()[:150]}")
        # print next few lines
        for j in range(i+1, min(i+5, len(lines))):
            print(f"  Line {j+1}: {lines[j].strip()[:120]}")
