"""
Re-encodes the base64 PNGs inside the letterhead SVGs, losslessly.

Why this exists: the office's SVGs carry 762 KB of raster inside a letterhead that
is mostly flat black. The image is 67% solid black and the rest is antialiased
glyph edges, so a real deflate with a per-row filter should land far below the
472 KB the original encoder produced. The original appears to have written the
scanlines unfiltered.

Lossless is not negotiable here. The output goes on a document the client
receives, and a recompression that quietly shifted colours would be worse than a
slow page. Every image is written, read back, and compared to the source pixel for
pixel before it is allowed near the SVG.

The PNG is written by hand because there is no image library here worth adding
for one job: IHDR, IDAT with Paeth-filtered scanlines, IEND.
"""
import base64
import pathlib
import re
import struct
import zlib


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def read_png(data: bytes):
    """
    Minimal PNG reader: 8-bit, non-interlaced, colour types 0/2/3/4/6.
    Returns (w, h, bytes_per_pixel, pixels) with pixels in the file's own layout,
    so a round trip through write_png is byte-identical.
    """
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('bukan PNG')
    pos, idat, plte, trns, meta = 8, bytearray(), None, None, None
    while pos < len(data):
        (ln,) = struct.unpack('>I', data[pos:pos + 4])
        typ = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, depth, ctype, comp, filt, inter = struct.unpack('>IIBBBBB', body)
            if depth != 8 or inter != 0 or ctype not in (0, 2, 3, 4, 6):
                raise ValueError(f'tipe tidak didukung: depth={depth} ctype={ctype} interlace={inter}')
            meta = (w, h, ctype)
        elif typ == b'PLTE':
            plte = body
        elif typ == b'tRNS':
            trns = body
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break
        pos += 12 + ln
    if meta is None:
        raise ValueError('tidak ada IHDR')
    w, h, ctype = meta
    n = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    raw = zlib.decompress(bytes(idat))
    stride = w * n
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if f == 1:
            for i in range(n, stride):
                line[i] = (line[i] + line[i - n]) & 0xFF
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:
            for i in range(stride):
                left = line[i - n] if i >= n else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif f == 4:
            for i in range(stride):
                left = line[i - n] if i >= n else 0
                up = prev[i]
                ul = prev[i - n] if i >= n else 0
                line[i] = (line[i] + paeth(left, up, ul)) & 0xFF
        elif f != 0:
            raise ValueError(f'filter tidak dikenal: {f}')
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, n, ctype, bytes(out), plte, trns


def write_png(w: int, h: int, n: int, ctype: int, pix: bytes, plte: bytes | None, trns: bytes | None) -> bytes:
    stride = w * n
    raw = bytearray()
    prev = bytearray(stride)
    for y in range(h):
        line = pix[y * stride:(y + 1) * stride]
        raw.append(4)  # Paeth
        enc = bytearray(stride)
        for i in range(stride):
            left = line[i - n] if i >= n else 0
            up = prev[i]
            ul = prev[i - n] if i >= n else 0
            enc[i] = (line[i] - paeth(left, up, ul)) & 0xFF
        raw += enc
        prev = line

    def chunk(typ: bytes, body: bytes) -> bytes:
        return (struct.pack('>I', len(body)) + typ + body
                + struct.pack('>I', zlib.crc32(typ + body) & 0xFFFFFFFF))

    out = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ctype, 0, 0, 0))
    if plte:
        out += chunk(b'PLTE', plte)
    if trns:
        out += chunk(b'tRNS', trns)
    out += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    out += chunk(b'IEND', b'')
    return out


def process(folder: pathlib.Path):
    total_before = total_after = 0
    for svg in sorted(folder.glob('*.svg')):
        s = svg.read_text(encoding='utf-8', errors='replace')
        report = []

        def swap(m):
            nonlocal total_before, total_after
            src = base64.b64decode(m.group(2))
            w, h, n, ctype, pix, plte, trns = read_png(src)
            dst = write_png(w, h, n, ctype, pix, plte, trns)
            # Verify before it is allowed anywhere near the file.
            rw, rh, rn, rc, rpix, rp, rt = read_png(dst)
            if (rw, rh, rn, rc) != (w, h, n, ctype) or rpix != pix or rp != plte or rt != trns:
                raise SystemExit(f'VERIFIKASI GAGAL: {svg.name} - pixel tidak identik')
            total_before += len(src)
            total_after += len(dst)
            report.append(f"{w}x{h} tipe{ctype} {len(src)/1024:6.1f} -> {len(dst)/1024:6.1f} KB")
            return m.group(1) + base64.b64encode(dst).decode('ascii') + '"'

        s2 = re.sub(r'(<image\b[^>]*?xlink:href="data:image/png;base64,)([^"]+)"', swap, s)
        if report:
            svg.write_text(s2, encoding='utf-8')
        print(f"  {svg.name}")
        for r in report:
            print(f"     {r}")
    print(f"\n  total base64: {total_before/1024:.0f} KB -> {total_after/1024:.0f} KB")
    return total_before, total_after


if __name__ == '__main__':
    import sys
    process(pathlib.Path(sys.argv[1]))
