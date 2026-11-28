import re

with open("c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html", "r", encoding="utf-8") as f:
    text = f.read()

lines = text.split('\n')

# Check if sk-site class is added by JS somewhere
for i, line in enumerate(lines):
    if 'sk-site' in line:
        print(f"Line {i+1}: {line.strip()[:180]}")
