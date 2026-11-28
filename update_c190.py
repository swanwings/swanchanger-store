import re

with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace GIF URL with the unique hash name
text = re.sub(r'https://swanchanger\.web\.app/assets/[^\"]+\.gif[^\"]*', 'https://swanchanger.web.app/assets/sw-smoke-aca6d965.gif', text)

with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print('Updated GIF meta tags successfully on c190f77!')
