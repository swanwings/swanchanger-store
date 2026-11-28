import re

with open("c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html", "r", encoding="utf-8") as f:
    text = f.read()

lines = text.split('\n')

# Check if sk-site class appears in the HTML or in JS that adds it
for i, line in enumerate(lines):
    if 'sk-site' in line and ('classList' in line or 'className' in line or '<html' in line.lower() or '<body' in line.lower() or '<div' in line.lower()):
        print(f"Line {i+1}: {line.strip()[:200]}")

# Also check the WeaponStage JS
import os
js_dir = "c:/Users/pc/Desktop/SwanChanger/store-site/public/_astro"
for f in os.listdir(js_dir):
    path = os.path.join(js_dir, f)
    with open(path, 'r', encoding='utf-8', errors='ignore') as fh:
        content = fh.read()
    if 'sk-site' in content:
        print(f"\nsk-site found in {f}")
        idx = content.find('sk-site')
        print(content[max(0,idx-100):idx+100])
