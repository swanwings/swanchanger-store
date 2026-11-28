with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Ensure .armory-inner.lobby-wrap is strictly centered with exact site wrap rules
# Also ensure .weapon-stage has a clean 2-column or balanced layout
layout_fix = """
  /* SwanChanger 3D Armory Layout Alignment — Center like .wrap */
  .armory-inner.lobby-wrap {
    width: min(1160px, 100% - 40px) !important;
    margin-inline: auto !important;
    padding-inline: 0 !important;
  }
  .armory .weapon-stage {
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr) !important;
    column-gap: 40px !important;
  }
  .armory-copy {
    padding-left: 10px !important;
  }
  .armory-chapter {
    padding-inline: 10px !important;
  }
  @media (max-width: 900px) {
    .armory .weapon-stage {
      grid-template-columns: minmax(0, 1fr) !important;
      gap: 20px !important;
    }
  }
"""

if '/* SwanChanger 3D Armory Layout Alignment — Center like .wrap */' in text:
    import re
    text = re.sub(r'/\* SwanChanger 3D Armory Layout Alignment — Center like \.wrap \*/[\s\S]*?(?=\/\* SwanChanger Custom Purple Cursor System \*\/)', layout_fix + '\n', text)

# 2. Check cursor CSS and guarantee pointer-events: none, high z-index, visibility and no conflict
cursor_css_fix = """
  /* SwanChanger Custom Purple Cursor System */
  html, body, a, button, input, select, textarea, canvas, [role="button"], * {
    cursor: none !important;
  }
  .custom-cursor-dot {
    position: fixed;
    top: 0;
    left: 0;
    width: 8px;
    height: 8px;
    background: #c4b5fd;
    border-radius: 50%;
    pointer-events: none !important;
    z-index: 2147483647 !important;
    transform: translate3d(-50%, -50%, 0);
    box-shadow: 0 0 10px rgba(167, 139, 250, 0.9);
    transition: width 0.15s ease, height 0.15s ease, background 0.2s ease, opacity 0.2s ease;
    will-change: left, top, transform;
  }
  .custom-cursor-ring {
    position: fixed;
    top: 0;
    left: 0;
    width: 34px;
    height: 34px;
    border: 1.5px solid rgba(167, 139, 250, 0.7);
    border-radius: 50%;
    pointer-events: none !important;
    z-index: 2147483646 !important;
    transform: translate3d(-50%, -50%, 0);
    transition: width 0.22s cubic-bezier(0.16, 1, 0.3, 1), height 0.22s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease, background 0.2s ease;
    box-shadow: 0 0 14px rgba(124, 58, 237, 0.4);
    will-change: left, top, transform;
  }
  body.cursor-hover .custom-cursor-ring {
    width: 52px;
    height: 52px;
    border-color: #a78bfa;
    background: rgba(124, 58, 237, 0.15);
    box-shadow: 0 0 24px rgba(167, 139, 250, 0.75);
  }
  body.cursor-hover .custom-cursor-dot {
    background: #ffffff;
    width: 6px;
    height: 6px;
    box-shadow: 0 0 14px #ffffff;
  }
  body.cursor-grab .custom-cursor-ring {
    width: 44px;
    height: 44px;
    border: 2px dashed #00f0ff;
    border-radius: 50%;
    background: rgba(0, 240, 255, 0.12);
    box-shadow: 0 0 20px rgba(0, 240, 255, 0.6);
  }
  body.cursor-grab .custom-cursor-dot {
    background: #00f0ff;
    box-shadow: 0 0 12px #00f0ff;
  }
  body.cursor-grabbing .custom-cursor-ring {
    width: 28px;
    height: 28px;
    border: 2px solid #a78bfa;
    background: rgba(124, 58, 237, 0.35);
    box-shadow: 0 0 25px rgba(167, 139, 250, 0.9);
  }
  .click-ripple {
    position: fixed;
    border-radius: 50%;
    border: 2px solid #a78bfa;
    background: radial-gradient(circle, rgba(167, 139, 250, 0.45) 0%, rgba(124, 58, 237, 0.2) 50%, transparent 80%);
    pointer-events: none !important;
    z-index: 2147483645 !important;
    transform: translate3d(-50%, -50%, 0) scale(0.2);
    animation: rippleExpand 0.55s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
  }
  @keyframes rippleExpand {
    0% {
      opacity: 1;
      transform: translate3d(-50%, -50%, 0) scale(0.2);
    }
    100% {
      opacity: 0;
      transform: translate3d(-50%, -50%, 0) scale(2.5);
    }
  }
"""

if '/* SwanChanger Custom Purple Cursor System */' in text:
    import re
    text = re.sub(r'/\* SwanChanger Custom Purple Cursor System \*\/[\s\S]*?(?=</style>)', cursor_css_fix + '\n', text)

# 3. Robust Cursor JS: Remove restrictive matchMedia so it ALWAYS runs on mouse movement
cursor_js_fix = """<script>
// SwanChanger Custom Cursor & Ripple System
(function() {
  const dot = document.getElementById('cursorDot');
  const ring = document.getElementById('cursorRing');
  if (!dot || !ring) return;

  let mouseX = -100, mouseY = -100;
  let ringX = -100, ringY = -100;
  let hasMoved = false;

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    dot.style.left = mouseX + 'px';
    dot.style.top = mouseY + 'px';
    if (!hasMoved) {
      ringX = mouseX;
      ringY = mouseY;
      dot.style.opacity = '1';
      ring.style.opacity = '1';
      hasMoved = true;
    }
  }, { passive: true });

  function renderCursor() {
    if (hasMoved) {
      ringX += (mouseX - ringX) * 0.25;
      ringY += (mouseY - ringY) * 0.25;
      ring.style.left = ringX + 'px';
      ring.style.top = ringY + 'px';
    }
    requestAnimationFrame(renderCursor);
  }
  requestAnimationFrame(renderCursor);

  const hoverSelector = 'a, button, input, select, textarea, [role="button"], .skin-choice, .lineup-card, .feat, .plan, summary, .close, .navbtn';

  document.addEventListener('mouseover', (e) => {
    const target = e.target;
    if (target.closest('.stage-canvas') || target.closest('canvas')) {
      document.body.classList.remove('cursor-hover');
      document.body.classList.add('cursor-grab');
    } else if (target.closest(hoverSelector)) {
      document.body.classList.remove('cursor-grab');
      document.body.classList.add('cursor-hover');
    } else {
      document.body.classList.remove('cursor-hover', 'cursor-grab', 'cursor-grabbing');
    }
  });

  document.addEventListener('mousedown', (e) => {
    const target = e.target;
    if (target.closest('.stage-canvas') || target.closest('canvas')) {
      document.body.classList.add('cursor-grabbing');
    }

    // Ripple effect
    const ripple = document.createElement('div');
    ripple.className = 'click-ripple';
    const size = 56;
    ripple.style.width = size + 'px';
    ripple.style.height = size + 'px';
    ripple.style.left = e.clientX + 'px';
    ripple.style.top = e.clientY + 'px';
    document.body.appendChild(ripple);

    setTimeout(() => {
      ripple.remove();
    }, 550);
  });

  document.addEventListener('mouseup', () => {
    document.body.classList.remove('cursor-grabbing');
  });

  document.addEventListener('mouseleave', () => {
    dot.style.opacity = '0';
    ring.style.opacity = '0';
  });

  document.addEventListener('mouseenter', () => {
    if (hasMoved) {
      dot.style.opacity = '1';
      ring.style.opacity = '1';
    }
  });
})();
</script>"""

import re
text = re.sub(r'<script>\s*// SwanChanger Custom Cursor & Ripple System[\s\S]*?</script>', cursor_js_fix, text)

with open('c:/Users/pc/Desktop/SwanChanger/store-site/public/index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print('Updated layout centering and robust cursor successfully!')
