"""Validate export dimensions, alpha, outlined type, monochrome paint and ICO payloads.
Run with a Python environment containing Pillow: python branding/verify.py
"""
from pathlib import Path
from PIL import Image
import json
import struct
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent
app_sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024]
tray_sizes = [16, 20, 24, 32, 64]
results = {'png_dimensions_and_alpha': [], 'ico_sizes': [], 'svg_files': 0}
for kind, sizes in [('app-icon', app_sizes), ('tray', tray_sizes)]:
    for size in sizes:
        file = root / 'export' / f'{kind}-{size}.png'
        with Image.open(file) as im:
            assert im.size == (size, size), file
            assert im.mode == 'RGBA', (file, im.mode)
            alpha = im.getchannel('A')
            assert alpha.getextrema() == (0, 255), file
            box = alpha.getbbox()
            if kind == 'tray':
                assert box[0] > 0 and box[1] > 0 and box[2] < size and box[3] < size, (file, box)
        results['png_dimensions_and_alpha'].append(f'{kind}-{size}')

for file in root.rglob('*.svg'):
    tree = ET.parse(file)
    assert tree.getroot().attrib.get('viewBox'), file
    assert not list(tree.iter('{http://www.w3.org/2000/svg}text')), file
    for element in tree.iter():
        for key, value in element.attrib.items():
            assert not (key.endswith('href') and not value.startswith('#')), file
            if file.name.startswith('logo-mark-mono') and key in ('fill', 'stroke'):
                assert value in ('currentColor', 'none'), (file, value)
    results['svg_files'] += 1

data = (root / 'export/icon.ico').read_bytes()
reserved, kind, count = struct.unpack_from('<HHH', data)
assert (reserved, kind, count) == (0, 1, 8)
for i, size in enumerate([16, 20, 24, 32, 40, 48, 64, 256]):
    w, h, colors, zero, planes, depth, length, offset = struct.unpack_from('<BBBBHHII', data, 6+16*i)
    assert (w or 256, h or 256, planes, depth) == (size, size, 1, 32)
    assert data[offset:offset+length] == (root / 'export' / f'app-icon-{size}.png').read_bytes()
    results['ico_sizes'].append(size)
with Image.open(root / 'export/icon.ico') as ico:
    assert ico.ico.sizes() == {(n, n) for n in results['ico_sizes']}

assert (root / 'preview.html').stat().st_size > 0
with Image.open(root / 'preview.png') as im:
    assert im.width == 1160 and im.height > 1500
    results['preview_dimensions'] = list(im.size)
print(json.dumps(results, indent=2))
