with open(r'c:\Users\pc\Desktop\SwanChanger\store-site\public\index.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
matches = re.findall(r'(\.armory[^{]*\{[^}]+\}|\.weapon-stage[^{]*\{[^}]+\}|\.armory-copy[^{]*\{[^}]+\}|\.lobby-wrap[^{]*\{[^}]+\}|\.armory-inner[^{]*\{[^}]+\})', text)
for m in matches[:15]:
    print(m)
    print("---")
