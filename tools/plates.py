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
    'hare.png': 'hare',
    'deer.png': 'deer',
    'boar.png': 'boar',
}

# 3:1, and oversampled twice over for the size it renders at. Quality 82 is where these
# stop getting smaller without the flat grey skies starting to band.
WIDTH, HEIGHT = 1200, 400
QUALITY = 82

# The camp's own plate, which is not a region and so is not in the map above.
#
# The band at the head of the roads block is a place while one is pressed and the camp while
# none is, and only half of that had a photograph under it. This is the other half, so
# `.roadband.at-camp` stands on the same ground `.roadband.at-place` has always had.
#
# Its own size because its master is its own shape -- 4.69:1 against the regions' 3:1 -- and
# kept rather than cropped to theirs, because the band crops with `cover` and where that crop
# falls is a CSS decision that should stay one. At 1400 wide it is oversampled for a 1082px
# band on a 2x screen by about a third, the same margin the regions carry.
#
# A path rather than a bare name, because the banner masters came as a set of eleven
# alternatives and the eleven are worth keeping beside the one that was chosen.
CAMP = {
    os.path.join('camp-banner', 'camp-banner-style-c-3d-diorama.jpg'): 'camp-banner',
}
CAMP_WIDTH, CAMP_HEIGHT = 1400, 298

# And a tone lift, which none of the regions need and this one cannot do without.
#
# The veil over a plate is .88, and that figure was walked down against the region set --
# eleven overcast daylight photographs whose median pixel sits at 88 of 255. The camp is a
# night shot: its median is 32, so the same veil had a quarter as much to show through and
# the band came out a texture nobody could see. Measured: spread across the finished band
# was 11 against Coastal Wreckage's 19, and the band's mean went *down* five points from the
# flat fill it replaced.
#
# Fixed here rather than by thinning the veil over this one band, because the veil is the
# rule that keeps every plate legible under text and a second value for it would be a second
# rule. What is actually different about this picture is its exposure, so that is what moves.
#
# 0.52 was fitted rather than chosen: swept against the finished band and kept where the
# numbers met Coastal Wreckage's, which is the plate both bands were tuned against.
#
#     camp at 1.00   mean 23.3   p98 30.1   p99.9 34.3   spread 11.0
#     camp at 0.52   mean 29.3   p98 37.1   p99.9 41.0   spread 16.0
#     coastal        mean 29.4   p98 38.9   p99.9 40.1   spread 18.8
#
# p99.9 is the one that has to land, because it is the brightest ground a glyph actually
# sits on and therefore what sets the contrast floor -- 41.0 against 40.1 means the camp band
# holds the same floor the region bands hold, and no grey in it has to move.
CAMP_GAMMA = 0.52

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

lift = [max(0, min(255, round(255 * (i / 255) ** CAMP_GAMMA))) for i in range(256)] * 3

for name, slug in sorted(CAMP.items()):
    out = os.path.join(out_dir, slug + '.webp')
    image = Image.open(os.path.join(src_dir, name)).convert('RGB')
    # Resized first, so the lift runs over the pixels that ship rather than over four times
    # as many that are about to be averaged away.
    image.resize((CAMP_WIDTH, CAMP_HEIGHT), Image.LANCZOS).point(lift).save(
        out, 'WEBP', quality=QUALITY, method=6
    )

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
