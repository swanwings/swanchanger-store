import re

with open("c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html", "r", encoding="utf-8") as f:
    text = f.read()

# 1. Check what's happening with cursor
print("=== CURSOR DIAGNOSTICS ===")
print("cursorDot div:", "cursorDot" in text)
print("cursorRing div:", "cursorRing" in text)
print("cursor CSS class:", ".custom-cursor-dot" in text)
print("cursor JS renderCursor:", "renderCursor" in text)
print("cursor: none:", "cursor: none !important" in text)

# 2. Check armory layout - does armory-inner have a max-width constraint?
print("\n=== ARMORY LAYOUT ===")
# The armory section is full-width (no .wrap wrapper). 
# armory-inner.lobby-wrap needs width constraint + centering
armory_inner_matches = re.findall(r'[^{}\n]*\.armory-inner[^{}\n]*\{[^}]*\}', text)
for m in armory_inner_matches:
    print(m.strip()[:120])

# 3. Check armory-selector-area for centering
print("\n=== ARMORY SELECTOR ===")
selector_matches = re.findall(r'[^{}\n]*\.armory-selector[^{}\n]*\{[^}]*\}', text)
for m in selector_matches:
    print(m.strip()[:120])

# 4. Check if .sk-site class is on the page
print("\n=== sk-site class ===")
print("sk-site in body/html:", "sk-site" in text)

# 5. Check weapon-stage grid
print("\n=== WEAPON STAGE GRID ===")
ws_matches = re.findall(r'\.armory \.weapon-stage\{[^}]*\}', text)
for m in ws_matches:
    print(m[:150])

# 6. Check the armory section structure 
idx = text.find('class="armory"')
print("\n=== ARMORY STRUCTURE (first 500 chars) ===")
print(text[idx:idx+500])
