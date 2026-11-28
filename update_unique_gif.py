import shutil
import uuid
import re

unique_id = uuid.uuid4().hex[:8]
new_name = f'sw-smoke-{unique_id}.gif'
src = 'C:/Users/pc/Downloads/SwanWings web sitesi gif.gif'
dst = f'c:/Users/pc/Desktop/SwanChanger/store-site/public/assets/{new_name}'
shutil.copy2(src, dst)
print('Created new GIF file:', new_name)

with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace any previous banner GIF references in meta tags
text = re.sub(
    r'https://swanchanger\.web\.app/assets/[^\"]+\.gif[^\"]*',
    f'https://swanchanger.web.app/assets/{new_name}',
    text
)

with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print('Updated public/index.html with', new_name)
