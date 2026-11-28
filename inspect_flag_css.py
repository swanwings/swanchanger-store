with open(r'c:\Users\pc\Desktop\SwanChanger\store-site\public\index.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
matches = re.findall(r'(\.plan[^{]*\{[^}]+\}|\.flag[^{]*\{[^}]+\})', text)
for m in matches:
    print(m)
    print("---")
