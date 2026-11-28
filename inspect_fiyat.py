with open(r'c:\Users\pc\Desktop\SwanChanger\store-site\public\index.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
fiyat = re.search(r'<section[^>]*id="fiyatlar".*?</section>', text, re.S)
if fiyat:
    print(fiyat.group(0))
else:
    print("fiyatlar not found")
