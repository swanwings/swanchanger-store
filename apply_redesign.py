import shutil
import re

# 1. Create a cache-busted copy of the banner GIF
src_gif = 'c:/Users/pc/Desktop/SwanChanger/store-site/public/assets/swanchanger-banner.gif'
new_gif_name = 'swanwings-signature.gif'
dst_gif = f'c:/Users/pc/Desktop/SwanChanger/store-site/public/assets/{new_gif_name}'
shutil.copy2(src_gif, dst_gif)

with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

# 2. Update og:image and twitter:image to new filename
text = text.replace('swanchanger-banner.gif', f'{new_gif_name}?v=4')

# 3. Add Top Scroll Progress Bar HTML right under <body>
scroll_bar_html = '<div id="scrollProgressBar" class="scroll-progress-bar" aria-hidden="true"></div>\n'
if 'id="scrollProgressBar"' not in text:
    text = text.replace('<body>', '<body>\n' + scroll_bar_html, 1)

# 4. Remove weapon navigation arrows (<div class="weapon-navigation" ...>...</div>)
text = re.sub(r'<div class="weapon-navigation"[\s\S]*?</div></div>', '<div class="weapon-navigation" data-weapon-navigation style="display:none !important;" hidden></div>', text)

# 5. Master CSS additions for:
# - Armory section centered with site theme background
# - Weapon navigation arrows completely hidden
# - Cyan elements turned to brand Purple (#a78bfa / #7c3aed / #c4b5fd)
# - Armory background and skin choice cards themed in purple/dark violet
# - Top scroll progress bar
# - Centering armory-inner and skin cards
theme_and_layout_css = """
  /* Top Scroll Progress Bar */
  .scroll-progress-bar {
    position: fixed;
    top: 0;
    left: 0;
    width: 0%;
    height: 3px;
    background: linear-gradient(90deg, #7c3aed, #a78bfa 50%, #c4b5fd);
    z-index: 9999999;
    pointer-events: none;
    box-shadow: 0 0 10px rgba(167, 139, 250, 0.8), 0 0 20px rgba(124, 58, 237, 0.5);
    transition: width 0.08s linear;
  }

  /* SwanChanger 3D Armory Layout Alignment — True Center */
  #loadout.armory {
    background: #090713 !important;
    background-image: radial-gradient(at 50% 20%, rgba(124, 58, 237, 0.12), transparent 70%) !important;
    width: 100% !important;
    overflow: hidden !important;
  }
  .armory .armory-backdrop {
    background: radial-gradient(at 50% 30%, rgba(124, 58, 237, 0.14), transparent 60%) !important;
  }
  .armory .armory-backdrop > i,
  .armory .armory-backdrop > b {
    background: radial-gradient(#7c3aed18, transparent 65%) !important;
  }
  .armory-inner.lobby-wrap {
    width: min(1200px, 100% - 48px) !important;
    max-width: 1200px !important;
    margin-inline: auto !important;
    padding-inline: 0 !important;
    float: none !important;
  }
  .armory .weapon-stage {
    grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr) !important;
    column-gap: 40px !important;
    margin-inline: auto !important;
  }
  @media (max-width: 900px) {
    .armory .weapon-stage {
      grid-template-columns: minmax(0, 1fr) !important;
      gap: 24px !important;
    }
  }

  /* Hide Weapon Navigation Arrows */
  .weapon-navigation,
  [data-weapon-navigation],
  [data-weapon-prev],
  [data-weapon-next] {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
    width: 0 !important;
    height: 0 !important;
    opacity: 0 !important;
  }

  /* Convert all cyan 3D Armory elements to SwanWings Purple theme */
  .armory {
    --armory-cyan: #a78bfa !important;
  }
  .armory-chapter i {
    background: #a78bfa !important;
    box-shadow: 0 0 15px rgba(167, 139, 250, 0.6) !important;
  }
  .armory-copy h2 > strong,
  .sk-site .armory-copy > p strong {
    color: #c4b5fd !important;
  }
  .armory .armory-skin-check,
  .armory-skin-check {
    color: #a78bfa !important;
  }
  .armory .armory-free > span {
    color: #e9d5ff !important;
    background: rgba(124, 58, 237, 0.15) !important;
    border-color: rgba(167, 139, 250, 0.4) !important;
  }
  .armory .activate-3d {
    background: linear-gradient(135deg, #7c3aed, #a78bfa) !important;
    color: #ffffff !important;
    box-shadow: 0 0 20px rgba(124, 58, 237, 0.5) !important;
  }
  .armory-selector-heading svg {
    color: #a78bfa !important;
  }
  .armory .stage-orbit > b {
    border-top-color: #a78bfa !important;
  }

  /* Skin Cards & Background Theming */
  .armory .skin-choice {
    background: linear-gradient(145deg, #151124, #0e0b1a) !important;
    border-color: rgba(167, 139, 250, 0.18) !important;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
  }
  .armory .skin-choice:hover {
    background: linear-gradient(145deg, #201838, #140f26) !important;
    border-color: rgba(167, 139, 250, 0.45) !important;
    box-shadow: 0 8px 30px rgba(124, 58, 237, 0.3) !important;
    transform: translateY(-2px) !important;
  }
  .armory .skin-choice.selected {
    border-color: #a78bfa !important;
    box-shadow: 0 0 25px rgba(167, 139, 250, 0.35), inset 0 -3px #a78bfa !important;
    background: linear-gradient(145deg, #241944, #181130) !important;
  }
"""

# Replace the previous layout alignment block with the full theme & layout CSS
old_marker = '/* SwanChanger 3D Armory Layout Alignment — Center like .wrap */'
if old_marker in text:
    text = re.sub(r'/\* SwanChanger 3D Armory Layout Alignment — Center like \.wrap \*/[\s\S]*?(?=\/\* SwanChanger Custom Purple Cursor System \*\/)', theme_and_layout_css + '\n', text)
else:
    text = text.replace('</style>', theme_and_layout_css + '\n</style>', 1)

# 6. Add JS for Top Scroll Progress Bar
scroll_js = """
// Top Scroll Progress Bar Script
window.addEventListener('scroll', () => {
  const bar = document.getElementById('scrollProgressBar');
  if (!bar) return;
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
  const scrollPercent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
  bar.style.width = scrollPercent + '%';
}, { passive: true });
"""

if 'scrollProgressBar' not in text or 'Top Scroll Progress Bar Script' not in text:
    text = text.replace('</body>', f'<script>{scroll_js}</script>\n</body>', 1)

with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print('All 6 requirements successfully updated in public/index.html!')
