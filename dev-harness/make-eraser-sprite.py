"""Turns the drawn eraser into the sprite that src/eraser-sprite.ts embeds.

Point SOURCE at the drawing and run it from this folder:
    python make-eraser-sprite.py
The paper around the eraser is flood-filled from the border, so the white
rubber tip inside the outline keeps its colour.
"""
import base64
import io
from collections import deque

from PIL import Image, ImageFilter

SOURCE = r"C:\Users\jtiob\Downloads\Creating_SVG_eraser_icon_2K_202609041010.jpeg"
OUT_TS = r"..\src\eraser-sprite.ts"

img = Image.open(SOURCE).convert("RGB")
w, h = img.size
px = img.load()

# The paper the drawing sits on, sampled from the corners.
corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
bg = tuple(sum(c[i] for c in corners) // len(corners) for i in range(3))
print("background", bg, "size", img.size)

TOLERANCE = 30

def near_bg(p):
    return abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]) <= TOLERANCE * 3

# Flood fill from the border: only the paper AROUND the eraser goes, so the
# white rubber tip inside the outline keeps its colour.
outside = bytearray(w * h)
queue = deque()
for x in range(w):
    for y in (0, h - 1):
        if near_bg(px[x, y]) and not outside[y * w + x]:
            outside[y * w + x] = 1
            queue.append((x, y))
for y in range(h):
    for x in (0, w - 1):
        if near_bg(px[x, y]) and not outside[y * w + x]:
            outside[y * w + x] = 1
            queue.append((x, y))
while queue:
    x, y = queue.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h and not outside[ny * w + nx] and near_bg(px[nx, ny]):
            outside[ny * w + nx] = 1
            queue.append((nx, ny))

alpha = Image.frombytes("L", (w, h), bytes(0 if flag else 255 for flag in outside))
# A hair of blur on the mask alone softens the staircase the fill leaves behind.
alpha = alpha.filter(ImageFilter.GaussianBlur(1.2)).point(lambda v: 0 if v < 90 else (255 if v > 190 else int((v - 90) * 255 / 100)))

out = img.convert("RGBA")
out.putalpha(alpha)
box = out.getbbox()
print("bbox", box)
pad = 8
box = (max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + pad))
out = out.crop(box)

# Square canvas so the sprite can be dropped anywhere without stretching.
side = max(out.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(out, ((side - out.width) // 2, (side - out.height) // 2), out)
sprite = canvas.resize((256, 256), Image.LANCZOS)

buffer = io.BytesIO()
sprite.save(buffer, format="PNG", optimize=True)
data = buffer.getvalue()
print("png bytes", len(data))

encoded = base64.b64encode(data).decode("ascii")
lines = [encoded[i:i + 100] for i in range(0, len(encoded), 100)]
body = "\n".join('\t"%s" +' % chunk for chunk in lines[:-1]) + '\n\t"%s";' % lines[-1]
ts = (
    "/**\n"
    " * The eraser the board shows: the drawing the user made for it, keyed onto\n"
    " * transparency and embedded here so the plugin still ships as three files.\n"
    " */\n"
    "export const ERASER_SPRITE =\n"
    '\t"data:image/png;base64," +\n'
    f"{body}\n"
)
with io.open(OUT_TS, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(ts)
print("wrote", OUT_TS, len(ts), "chars")
