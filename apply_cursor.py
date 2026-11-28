import re

with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

cursor_dom = """<!-- SwanChanger Custom Cursor Elements -->
<div class="custom-cursor-dot" id="cursorDot" aria-hidden="true"></div>
<div class="custom-cursor-ring" id="cursorRing" aria-hidden="true"></div>
"""

if 'id="cursorDot"' not in text:
    text = text.replace('<body>', '<body>\n' + cursor_dom, 1)

cursor_script = """<script>
// SwanChanger Custom Cursor & Ripple System
(function() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const dot = document.getElementById('cursorDot');
  const ring = document.getElementById('cursorRing');
  if (!dot || !ring) return;

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let ringX = mouseX;
  let ringY = mouseY;
  let isMoving = false;

  window.addEventListener('pointermove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    dot.style.left = mouseX + 'px';
    dot.style.top = mouseY + 'px';
    if (!isMoving) {
      ringX = mouseX;
      ringY = mouseY;
      isMoving = true;
    }
  }, { passive: true });

  function renderCursor() {
    ringX += (mouseX - ringX) * 0.22;
    ringY += (mouseY - ringY) * 0.22;
    ring.style.left = ringX + 'px';
    ring.style.top = ringY + 'px';
    requestAnimationFrame(renderCursor);
  }
  requestAnimationFrame(renderCursor);

  const hoverSelector = 'a, button, input, [role="button"], .skin-choice, .lineup-card, .feat, .plan, summary, .close, .navbtn, select';
  
  document.addEventListener('pointerover', (e) => {
    const target = e.target;
    if (target.closest('.stage-canvas') || target.closest('.weapon-stage canvas')) {
      document.body.classList.remove('cursor-hover');
      document.body.classList.add('cursor-grab');
    } else if (target.closest(hoverSelector)) {
      document.body.classList.remove('cursor-grab');
      document.body.classList.add('cursor-hover');
    } else {
      document.body.classList.remove('cursor-hover', 'cursor-grab', 'cursor-grabbing');
    }
  });

  document.addEventListener('pointerdown', (e) => {
    const target = e.target;
    if (target.closest('.stage-canvas') || target.closest('.weapon-stage canvas')) {
      document.body.classList.add('cursor-grabbing');
    }

    const ripple = document.createElement('div');
    ripple.className = 'click-ripple';
    const size = 60;
    ripple.style.width = size + 'px';
    ripple.style.height = size + 'px';
    ripple.style.left = e.clientX + 'px';
    ripple.style.top = e.clientY + 'px';
    document.body.appendChild(ripple);

    setTimeout(() => {
      ripple.remove();
    }, 600);
  });

  document.addEventListener('pointerup', () => {
    document.body.classList.remove('cursor-grabbing');
  });

  document.addEventListener('mouseleave', () => {
    dot.style.opacity = '0';
    ring.style.opacity = '0';
  });

  document.addEventListener('mouseenter', () => {
    dot.style.opacity = '1';
    ring.style.opacity = '1';
  });
})();
</script>"""

if 'SwanChanger Custom Cursor & Ripple System' not in text:
    text = text.replace('</body>', cursor_script + '\n</body>', 1)

with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print('Injected cursor DOM and JS successfully!')
