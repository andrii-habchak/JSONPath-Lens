"""Generate the extension icons (public/icon/{16,32,48,128}.png). Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw, ImageFont
import os

S = 512
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([16, 16, S - 16, S - 16], radius=110, fill=(37, 99, 235, 255))
# Lens
cx, cy, r = 215, 215, 128
d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, 255), width=44)
d.line([cx + 92, cy + 92, 420, 420], fill=(255, 255, 255, 255), width=64)
d.ellipse([420 - 32, 420 - 32, 420 + 32, 420 + 32], fill=(255, 255, 255, 255))
# Braces inside the lens
font = None
for path in ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf']:
    if os.path.exists(path):
        font = ImageFont.truetype(path, 150)
        break
if font:
    d.text((cx, cy - 6), '{}', font=font, fill=(255, 255, 255, 255), anchor='mm')
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'icon')
for size in (16, 32, 48, 128):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(out, f'{size}.png'))
img.resize((256, 256), Image.LANCZOS).save(os.path.join(out, '..', 'logo.png'))
print('icons written')
