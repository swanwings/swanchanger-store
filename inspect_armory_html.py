with open(r'c:\Users\pc\Desktop\SwanChanger\store-site\public\index.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
armory_idx = text.find('class="armory"')
if armory_idx != -1:
    print(text[armory_idx:armory_idx+1500])
