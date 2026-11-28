with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
text = re.sub(r'<meta property="og:image:width" content="\d+">', '<meta property="og:image:width" content="468">', text)
text = re.sub(r'<meta property="og:image:height" content="\d+">', '<meta property="og:image:height" content="60">', text)

with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print('Updated width/height to 468x60 successfully!')
