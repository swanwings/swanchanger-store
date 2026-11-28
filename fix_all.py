import re

with open("c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html", "r", encoding="utf-8") as f:
    text = f.read()

# FIX 1: ARMORY CENTERING
# The armory section (.armory) is full-width with overflow:clip. 
# .armory-inner.lobby-wrap only has padding-block, no max-width or margin centering by default.
# Our @media(min-width:981px) added max-width:1400px + margin-inline:auto, 
# but it needs to also set width for it to take effect since armory-inner has no width constraint.
# 
# The REAL issue: armory-inner has no max-width in the default CSS. It just fills the armory section.
# The armory section itself has no max-width wrapper - it's edge-to-edge.
# Looking at the original skinchanger.gg site, their armory section IS also edge-to-edge,
# but the user wants the TEXT portion centered/shifted right.
# 
# From screenshot: Text is at extreme left. User wants it centered (like how .wrap centers other content).
# Solution: Give .armory-inner.lobby-wrap a max-width matching .wrap (1160px) + margin:auto

# Remove old custom alignment block and replace with better one
old_alignment = """  /* SwanChanger 3D Armory Layout Alignment */
  @media (min-width: 981px) {
    .armory-inner.lobby-wrap {
      max-width: 1400px;
      margin-inline: auto;
      padding-inline: 40px;
    }
    .armory .weapon-stage {
      grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
      column-gap: 50px;
    }
    .armory-chapter {
      padding-left: 20px;
      padding-right: 20px;
    }
    .armory-copy {
      padding-left: 25px;
      max-width: 540px;
    }
  }"""

new_alignment = """  /* SwanChanger 3D Armory Layout Alignment — Center like .wrap */
  .armory-inner.lobby-wrap {
    width: min(1160px, 100% - 40px);
    margin-inline: auto;
  }"""

assert old_alignment in text, "Old alignment block not found!"
text = text.replace(old_alignment, new_alignment, 1)

# FIX 2: CURSOR SYSTEM
# The cursor CSS and JS are present but the glove-grab cursor override on line 579
# uses: body .armory .stage-canvas { cursor: url(...glove-grab.svg) 14 14, grab }
# This has higher specificity and uses cursor property directly.
# Our "* { cursor: none !important }" should override with !important.
# BUT — the cursor elements (dot+ring) might not be visible if they start at 0,0 with
# opacity hidden. Let me also check if the JS initialises properly.

# The cursor CSS is wrapped in @media (hover: hover) and (pointer: fine)
# This means on TOUCH devices it won't show (correct).
# On desktop with mouse, it should work.

# Potential issue: The cursor CSS uses just class selectors like .custom-cursor-dot
# but the div elements are inside <body> at the very top.
# Let me verify the DOM elements are right after <body>

body_idx = text.find('<body>')
after_body = text[body_idx:body_idx+300]
print("After <body>:")
print(after_body)

print("\n\nBefore </body>:")
end_body_idx = text.rfind('</body>')
before_end = text[max(0,end_body_idx-200):end_body_idx+10]
print(before_end)

with open("c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html", "w", encoding="utf-8") as f:
    f.write(text)

print("\n\nDone! Alignment fixed.")
