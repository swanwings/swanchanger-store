import re

with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

# DIAGNOSIS: The CSS rule hiding [data-weapon-navigation] is TOO broad.
# It uses attribute selector [data-weapon-navigation] which could match
# the PARENT div that contains weapon-navigation AND the skin selector.
# 
# The weapon-navigation div has: data-weapon-navigation attribute
# But the PARENT weapon-stage div has: data-stage attribute
# The JS sets: t.querySelector('[data-weapon-navigation]').hidden = false (reveals it)
# When JS runs: data-navigation="ready" is set on weapon-stage
#
# The CSS rules [data-weapon-navigation] { display: none } 
# will override the JS unhiding, but more importantly:
# The rule might interfere with layout since weapon-navigation
# is inside stage-bottom which affects the flex layout.
#
# REAL ISSUE: The intermittent bug is likely because:
# 1. On first load, the WeaponStage JS hasn't run yet
# 2. The JS sets dataset.navigation = "ready" and unhides weapon-navigation
# 3. Our CSS forces display:none on [data-weapon-navigation]
# 4. This creates a conflict where the JS expects those elements to exist for click handlers
# 5. The weapon-prev and weapon-next buttons are used by JS to cycle skins
#    If they're hidden with width:0/height:0, their click handlers still fire but layout breaks

# Check if the weapon navigation buttons are referenced in JS
print("=== Checking weapon-navigation references ===")
nav_patterns = ['data-weapon-prev', 'data-weapon-next', 'data-weapon-navigation', 'weapon-navigation']
for pat in nav_patterns:
    count = text.count(pat)
    print(f"  {pat}: {count} occurrences")

# Check the WeaponStage JS file
js_path = 'c:/Users/pc/Desktop/SwanChanger/store-site/public/_astro/WeaponStage.astro_astro_type_script_index_0_lang.DAo8-q84.js'
with open(js_path, 'r', encoding='utf-8') as f:
    js = f.read()

for pat in nav_patterns:
    if pat in js:
        idx = js.find(pat)
        print(f"\n  JS has {pat} at pos {idx}: ...{js[max(0,idx-50):idx+80]}...")

# The JS does: 
# t.querySelector('[data-weapon-prev]').addEventListener('click', ...)
# t.querySelector('[data-weapon-next]').addEventListener('click', ...)
# t.querySelector('[data-weapon-navigation]').hidden = false
# t.dataset.navigation = 'ready'
#
# SOLUTION: Instead of hiding with display:none which breaks JS element queries,
# just make them visually invisible but keep them in DOM layout flow.
# OR better: just use visibility:hidden + position:absolute + overflow:hidden
# so they don't affect layout but JS can still find and use them.

print("\n=== SOLUTION ===")
print("Replace aggressive display:none with visual-only hiding that preserves DOM accessibility")
