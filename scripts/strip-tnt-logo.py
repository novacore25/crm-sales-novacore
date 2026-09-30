"""
Removes the logo from the TNT letterhead SVGs so a clean PNG can be placed over
it instead.

Why this exists: the logo in those SVGs is drawn as a greyscale image used as a
luminance mask, and Chromium's PDF output leaves a hairline rectangle around it -
visible when printed, invisible on screen. It reproduces when the raw SVG is
printed completely untouched, so it is in the export and not in how the file is
placed here. Three fixes were tried against the mask and none removed the line
without changing the logo: explicit bounds, mask-type="luminance", and an <img>
instead of a CSS background all left it, and dropping the mask cleared it but left
the logo on a black rectangle.

The mask also turns out to be the wrong artwork. It is a square lockup reading
"THICK & THIN MEDIA" over "Official TikTok Agency". Neither line appears on the
office's own quotation PDFs, which carry a landscape lockup: the mark beside
"Thick and Thin" and "Media Indonesia".

Only the logo goes. The title band and the footer bar are genuine vector work and
stay exactly as exported.

Matched structurally rather than by id: the two files are exports of the same
design and the generators renamed every id between them - the quotation's mask is
e04c8a997c and the invoice's is 39fb0e1903, with different clip ids too. The
anchor is the transform matrix, which is identical in both, and it is the only
place in either file where that matrix appears.

Idempotent: a second run finds nothing to remove.
"""
import pathlib
import re
import sys

# Present in both exports, and only in the logo group.
LOGO_MATRIX = r'matrix\(0\.145047,\s*0,\s*0,\s*0\.145047,\s*36\.585912,\s*0\.866538\)'

LOGO_GROUP = re.compile(
    r'<g clip-path="url\(#([0-9a-f]+)\)"\s*>'
    r'<g mask="url\(#([0-9a-f]+)\)"\s*>'
    r'<g transform="' + LOGO_MATRIX + r'">'
    r'<image\b[^>]*?/>'
    r'</g></g></g>',
    re.S,
)


def strip(path: pathlib.Path) -> None:
    src = path.read_text(encoding='utf-8')
    used_masks = set()

    def drop(m):
        used_masks.add(m.group(2))
        return ''

    out = LOGO_GROUP.sub(drop, src)
    # Remove the mask definitions the removed groups referenced. Done afterwards
    # and by id, so a mask belonging to anything else is left alone.
    for mid in used_masks:
        out = re.sub(r'<mask id="' + mid + r'"[^>]*>.*?</mask>', '', out, flags=re.S)

    leftovers = sum(len(re.findall(LOGO_MATRIX, out)) for _ in (0,))
    print(f"  {path.name}: logo dihapus, mask dibuang {len(used_masks)}, "
          f"sisa {leftovers}, {'berubah' if out != src else 'sudah bersih'}")
    if out != src:
        path.write_text(out, encoding='utf-8')


if __name__ == '__main__':
    print('Membuang logo dari letterhead TNT:')
    for name in ('tnt-quotation.svg', 'tnt-invoice.svg'):
        strip(pathlib.Path(sys.argv[1]) / name)
