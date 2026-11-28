import re

with open("c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html", "r", encoding="utf-8") as f:
    text = f.read()

# Check the CSS ordering: the .sk-site rules have `.armory .weapon-stage{grid-template-columns:minmax(0,1fr);gap:0}`
# which appears BEFORE our custom rules, but there might also be one AFTER (in the reduced-motion or theme block)
# that overrides our grid back to 1fr (single column).

# Find all weapon-stage grid rules with their line context
lines = text.split('\n')
for i, line in enumerate(lines):
    if 'weapon-stage' in line and 'grid-template' in line:
        print(f"Line {i+1}: {line.strip()[:150]}")

print("\n=== sk-site weapon-stage rules ===")
for i, line in enumerate(lines):
    if 'sk-site' in line and 'weapon-stage' in line:
        print(f"Line {i+1}: {line.strip()[:150]}")

# The key problem: .sk-site .armory .weapon-stage{grid-template-columns:minmax(0,1fr);gap:0}
# This sets it to SINGLE column, overriding our 2-column grid.
# We need to check if our body has sk-site class

print("\n=== body tag ===")
body_match = re.search(r'<body[^>]*>', text)
if body_match:
    print(body_match.group(0))

# Check if sk-site is applied via JS or class
for i, line in enumerate(lines):
    if 'sk-site' in line and ('class' in line or 'add' in line):
        print(f"Line {i+1}: {line.strip()[:150]}")
