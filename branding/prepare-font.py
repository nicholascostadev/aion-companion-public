"""Produce a temporary static Instrument Sans font for deterministic SVG outlines.
Usage: python branding/prepare-font.py <temporary-tool-directory>
fonttools and brotli must be installed in <temporary-tool-directory>/python.
The source font stays untouched; the output stays in the temporary directory.
"""
from pathlib import Path
import sys

tools = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(tools / 'python'))
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

repo = Path(__file__).resolve().parent.parent
source = repo / 'node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2'
font = TTFont(source)
font = instantiateVariableFont(font, {'wght': 600}, inplace=True)
font.flavor = None
font.save(tools / 'instrument-sans-600.ttf')
print('Prepared static weight 600 in temporary tooling directory.')
