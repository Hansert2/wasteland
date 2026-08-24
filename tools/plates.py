"""
The region plates: 25 MB of masters in `img/` -> ~800 KB of WebP in `public/img/`.

    python -m pip install --user pillow
    python tools/plates.py

Python rather than another `.mjs` beside it, and that is the whole reason: Node has no
image codec in the standard library, so the alternative was a native dependency in
`package.json` for a job that runs once per batch of art. Nothing at runtime imports
this — the server only reads what it writes.

Two things it fixes, both of which have already gone wrong once:

- **The names.** The files come out of the generator named however they were prompted,
  and the page finds a plate by the region's slug in `src/db/seed.js`. Five of the first
  eleven differed only by whether the article was on the front. The map below is the one
  place that mismatch is allowed to exist.
- **The weight.** A 2172x724 PNG is two and a half megabytes; the page it goes on is
  sixty kilobytes. At the size these actually render — a 168px strip beside a row — a
  1200x400 WebP is oversampled already.

A file in `img/` that is not in the map is skipped and named, rather than silently
dropped: a new plate with a typo in its name should stop and say so.
"""

import os
import sys

from PIL import Image

# On disk in img/  ->  slug in REGIONS (src/db/seed.js).
NAMES = {
    'fence_line.png': 'the_fence_line',
    'old_service_road.png': 'the_service_road',
    'the_ruined_city.png': 'ruined_city',
    'irradiated_farmland.png': 'irradiated_farmland',
    'underground_bunkers.png': 'underground_bunkers',
    'coastal_wreckage.png': 'coastal_wreckage',
    'the_deep_zone.png': 'the_deep_zone',
    'millrace.png': 'the_millrace',
    'sixteen_wells.png': 'sixteen_wells',
    'waterworks.png': 'the_waterworks',
    'harrow_end.png': 'harrow_end',
}

# 3:1, and oversampled twice over for the size it renders at. Quality 82 is where these
# stop getting smaller without the flat grey skies starting to band.
WIDTH, HEIGHT = 1200, 400
QUALITY = 82

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src_dir = os.path.join(root, 'img')
out_dir = os.path.join(root, 'public', 'img')

os.makedirs(out_dir, exist_ok=True)

unknown = []
written = 0
total = 0

for name in sorted(os.listdir(src_dir)):
    if not name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
        continue

    slug = NAMES.get(name)
    if slug is None:
        unknown.append(name)
        continue

    out = os.path.join(out_dir, slug + '.webp')
    image = Image.open(os.path.join(src_dir, name)).convert('RGB')
    image.resize((WIDTH, HEIGHT), Image.LANCZOS).save(out, 'WEBP', quality=QUALITY, method=6)

    size = os.path.getsize(out)
    total += size
    written += 1
    print(f'  {name:26} -> {slug + ".webp":26} {size / 1024:6.1f} KB')

print(f'\n{written} plates, {total / 1024:.0f} KB in public/img/')

if unknown:
    print('\nnot in the name map, so not shipped:', file=sys.stderr)
    for name in unknown:
        print(f'  {name}', file=sys.stderr)
    sys.exit(1)
