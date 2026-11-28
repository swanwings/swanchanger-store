with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

target = """<meta name="theme-color" content="#07060c">
<link rel="icon" type="image/png" href="/assets/shots/logo.png">
<meta property="og:type" content="website">
<meta property="og:title" content="SwanChanger — CS2 Skinchanger & Helper">
<meta property="og:description" content="Silah, bıçak, eldiven, ajan, Bhop, FOV ve Lineup Helper. İndirimli $4.99 / $14.99. Tek dosya loader.">
<meta property="og:image" content="https://swanchanger.netlify.app/assets/shots/hero.jpg">"""

replacement = """<meta name="theme-color" content="#7c3aed">
<link rel="icon" type="image/png" href="/assets/shots/logo.png">

<!-- Discord & Social Open Graph Embed -->
<meta property="og:site_name" content="swanchanger.web.app">
<meta property="og:type" content="website">
<meta property="og:url" content="https://swanchanger.web.app/">
<meta property="og:title" content="SwanChanger — Premium CS2 Skinchanger & Inventory Assistant">
<meta property="og:description" content="SwanChanger — CS2 için silah, bıçak, eldiven ve ajan skinleri, Auto Bhop, FOV Changer ve Lineup Helper. Haftalık $4.99 / Aylık $14.99, anında aktivasyon ve 7/24 destek.">
<meta property="og:image" content="https://swanchanger.web.app/assets/swanchanger-banner.gif">
<meta property="og:image:type" content="image/gif">
<meta property="og:image:width" content="728">
<meta property="og:image:height" content="160">

<!-- Twitter Large Image Card for Discord / Telegram / Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@swanchanger">
<meta name="twitter:title" content="SwanChanger — Premium CS2 Skinchanger & Inventory Assistant">
<meta name="twitter:description" content="SwanChanger — CS2 için silah, bıçak, eldiven ve ajan skinleri, Auto Bhop, FOV Changer ve Lineup Helper. Haftalık $4.99 / Aylık $14.99, anında aktivasyon ve 7/24 destek.">
<meta name="twitter:image" content="https://swanchanger.web.app/assets/swanchanger-banner.gif">"""

assert target in text, 'target string not found in index.html'
text = text.replace(target, replacement, 1)

with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print('Discord embed tags replaced successfully!')
