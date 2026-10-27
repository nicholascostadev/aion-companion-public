# AION Companion identity

Original vector geometry, designed for this app. The three marks were drawn directly as SVG paths; no traced source, generated raster artwork, game artwork, game lettering or icon library geometry is used. The logo is the app's own brand, not a class, skill or pet icon.

## Three directions

**01 — Wayseed, recommended.** Two broad, windborne vanes turn around a small compass seed. The open diagonal channel gives the symbol a bearing; the suspended lozenge gives it a living centre. It connects flight, finding your way and collecting knowledge without assigning the app to one feature such as combat. The paired curves also suggest a companion circling alongside you. Its filled silhouette has no fine feather barbs or hairline rings, and its three pieces remain usable in one colour. This is the strongest all-purpose direction because it carries the field-guide character and survives the smallest placements.

**02 — Fieldfold.** Three planes describe a folded page or trail map, with an oblique opening becoming a directional sight. The upright left page gives the mark a stable edge while the split right page suggests moving between a record and the world. This direction puts the app's reports, maps and reference role first. Its angular silhouette has a different voice from Wayseed: more editorial and precise, less organic. Master: `concepts/02-fieldfold.svg`.

**03 — Trail Lantern.** A seed-pod lantern holds a simple square aperture, with a small pale lozenge at its neck. Its round body and short stem make a quiet guide-light rather than a weapon or a heraldic crest. The square represents a useful window into the world: a report, alert or overlay that sheds light on what is happening. This is the gentlest direction, especially suitable to the collection and exploration side of the app, although the lantern metaphor is less distinctive at tray size. Master: `concepts/03-trail-lantern.svg`.

Wayseed master: `concepts/01-wayseed.svg`. The chosen production set below is Wayseed throughout.

## Construction

- **Master grid:** 64 × 64. Two identical filled Bézier vanes, with the second rotated 180° around (32,32). The vanes have broad curved backs, a concave inner sweep and a short cut tip. No outlines, blur or filters form the mark. The seed vertices are (32,25), (36,32), (32,39), (28,32). The symbol's approximate live bounds are x 9–55, y 7–57.
- **Clear space:** at least 8 master units beyond the visible mark, or approximately half the seed's height. Adjacent text begins after at least 12 master units. The supplied lockup includes this separation. Keep the full square viewBox for UI alignment; do not crop each component separately.
- **Master minimum:** 24 CSS px. Below 24 px, use the optical monochrome variant. Minimum in-app size is 14 CSS px. The 16 px optical SVG is deliberately suitable at 14–18 px; use the 20/24/32 optical files at their named sizes when practical.
- **Stroke widths:** the brand silhouette has none. Tray underlays use round joins and total stroke widths of 1 px at 16, 1.25 px at 20, 1.5 px at 24 and 1.5 px at 32. Because fill is painted over the underlay, the exterior dark keyline is half these widths. There is no drop shadow in the tray assets.
- **Pixel hinting:** each 16/20/24/32 drawing has separately chosen integer or half-integer coordinates, simplified tails and a widened diagonal channel. It is not a master SVG resized four times. The centre is exactly on each even-size grid's centre. The 16 px seed is 2 × 4 px; 20 px is 3 × 6; 24 px is 3 × 6; 32 px is 4 × 8. Straight diagonals and curves retain antialiasing; `crispEdges` would damage them. The wider seed and extra negative space compensate for antialiasing at small sizes. The tray's 64 px PNG is a clean 2× rasterization of the 32 px drawing.
- **Tray contrast:** a solid gold glyph sits over a warm-dark keyline. Gold reads on dark taskbars; the dark perimeter preserves the contour and the central channel on pale taskbars. The same transparent PNG works on both. There is no opaque square behind the tray glyph.
- **Application tile:** rounded square, corner radius 22% of its canvas, warm-dark vertical gradient and restrained gold rim. At 16–24 px the rim is 1 px; larger artwork uses 1/64 of the canvas. At 16/20/24/32 the tile uses the corresponding optical glyph. At 40 px and above it uses the master, with generous breathing room. The tile's corners remain transparent.
- **Wordmark:** the exact string “AION Companion”, Instrument Sans, normal style, weight 600. It uses the installed font's ordinary lettering, with font kerning and no imitation game letterforms. Every glyph is converted to an SVG path. The lockup needs no installed font at runtime. Its recommended minimum display width is 215 px.

Do not stretch, rotate the whole symbol, close its channel, add feather details, recolour its separate vanes independently with unrelated colours, or put the application tile around the in-app monochrome mark.

## Palette

The OKLCH values below are taken from `frontend/src/styles/theme.css`. SVG/PNG production uses their rounded, in-gamut sRGB equivalents. Exact theme gold is **#EEC066**, rather than the approximate #E9C46A in the brief.

| Role                  | Source token/value                       | sRGB      |
| --------------------- | ---------------------------------------- | --------- |
| Main gold             | accent · `oklch(0.83 0.12 82)`           | `#EEC066` |
| Pale gold             | accent-strong · `oklch(0.89 0.1 88)`     | `#F6D78C` |
| Seed / wordmark       | ink · `oklch(0.94 0.02 85)`              | `#F1EADC` |
| Tile base / canvas    | canvas · `oklch(0.155 0.012 70)`         | `#100B07` |
| Tray keyline          | solid-surface · `oklch(0.2 0.012 70)`    | `#1A1510` |
| Tile top              | solid-surface-3 · `oklch(0.28 0.016 72)` | `#2E2820` |
| Light-background mark | paper-ink · `oklch(0.36 0.035 65)`       | `#4A392A` |
| Light preview ground  | paper · `oklch(0.86 0.03 88)`            | `#D9D0BB` |
| Preview secondary ink | ink-3 · `oklch(0.72 0.022 80)`           | `#ACA396` |

Gold is intentionally replaced by dark umber for the light-background mark, so its legibility does not depend on a light gold against paper. The full-colour master uses main gold, pale gold and parchment. Its monochrome equivalent uses only `currentColor`, with no hard-coded paint. `palette.json` records the same sRGB conversions.

## Files and usage

| File                                                     | Use                                                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `logo-mark.svg`                                          | Transparent full-colour mark on dark backgrounds; Home, About and large brand placements                                      |
| `logo-mark-mono.svg`                                     | Master monochrome silhouette, 24 px and above                                                                                 |
| `logo-mark-mono-16.svg`, `-20.svg`, `-24.svg`, `-32.svg` | Optical inline monochrome silhouettes; header / in-game top bar; 16 variant at 14–18 px                                       |
| `logo-mark-light.svg`                                    | Dark umber mark on light backgrounds                                                                                          |
| `logo-lockup.svg`                                        | Outlined Instrument Sans wordmark and full-colour mark, for dark backgrounds                                                  |
| `app-icon.svg`                                           | Scalable application icon master on its own tile                                                                              |
| `app-icon-16.svg`, `-20.svg`, `-24.svg`, `-32.svg`       | Size-specific application tiles with optical glyphs                                                                           |
| `tray-16.svg`, `-20.svg`, `-24.svg`, `-32.svg`           | Transparent tray artwork with contrast keyline                                                                                |
| `export/app-icon-{size}.png`                             | 16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024 px application / installer assets                                             |
| `export/tray-{size}.png`                                 | 16, 20, 24, 32, 64 px tray assets                                                                                             |
| `export/icon.ico`                                        | Eight exact layers: 16, 20, 24, 32, 40, 48, 64, 256 px; app / taskbar / installer                                             |
| `export/favicon.svg`                                     | 16 px optical tiled icon in SVG form                                                                                          |
| `preview.html`                                           | Self-contained proof sheet, including embedded font and images; open directly in a browser                                    |
| `preview.png`                                            | Rendered 1160 px-wide proof sheet with all concepts, both grounds, lockup, tray proofs, 14/16/18 px pills and desktop taskbar |
| `export/geometry-proof.png`                              | Development contact sheet showing concept and tray geometry at enlargement                                                    |
| `build.mjs`, `prepare-font.py`, `verify.py`              | Reproduction and export validation tools                                                                                      |
| `Instrument-Sans-LICENSE.txt`                            | Font's SIL Open Font License, also covering the embedded preview font                                                         |

For UI tinting, inline the monochrome SVG or import it as an SVG component. A standalone SVG loaded through `<img>` cannot inherit the surrounding document's `currentColor`. Set the inline SVG's width and height to the intended CSS size, and let its parent set `color` from the theme. The production artwork is integrated through `BrandMark` in the workspace and top bar, browser icons in `frontend/public`, and app/launcher/tray icons in `src-tauri/icons`. The launcher rebuild fingerprint includes the icon checksum so artwork updates refresh its embedded icon.

## Export production and checks

Only development tooling was installed in a new directory outside the repository. No dependency or package manifest in the application was changed. Tool versions used: `@resvg/resvg-js` 2.6.2, `fontkit` 2.0.4, `fonttools` 4.67.0, `brotli` 1.2.0. Validation uses the existing Pillow 13 environment.

To reproduce, create a **new temporary directory** and install `@resvg/resvg-js` and `fontkit` there with `npm.cmd install --prefix <temp> @resvg/resvg-js fontkit`. Install Python font helpers there with `python -m pip install --target <temp>/python fonttools brotli`. Never run an install in the repository. With Node and Python on PATH:

```powershell
python branding/prepare-font.py <temp>
node branding/build.mjs <temp>
# Use a Python environment containing Pillow for this command:
python branding/verify.py
```

`prepare-font.py` instantiates the installed Instrument Sans WOFF2 at weight 600 and writes a temporary TTF outside the checkout. `build.mjs` gets its glyph outlines and positioning through fontkit, writes the hand-authored paths, then rasterizes the appropriate SVG directly at every target size using resvg. No PNG is resized from a previous PNG. The ICO directory wraps those exact PNG payloads, so its small layers preserve the hinting instead of being regenerated from the 256 px image. The 256 px layer is PNG-compressed, as supported by modern Windows.

`preview.html` embeds its font, SVGs and PNGs as data URLs and needs no server. `preview.png` was captured with T3 Code's Chromium `html_preview` at 1160 CSS px wide and device scale 1 after font loading; there were no console errors. The same page was also inspected at 390 px wide. The right-hand tray board uses nearest-neighbour 2× enlargement for inspection; the left-hand board uses the exact native PNG dimensions. To refresh the screenshot after rebuilding, render the generated HTML again with that browser tool or a browser's full-page screenshot at the same width.

Visual iteration widened the diagonal channel after the initial seed touched the vanes at small sizes. The final 16/20/24/32 rasters were inspected on both simulated taskbar grounds; all artwork was also inspected at enlargement. `verify.py` checks PNG dimensions and transparency, unclipped tray bounds, SVG parsing and monochrome paints, the absence of live text, the eight ICO layers, and byte-for-byte equality of every ICO frame with its matching PNG.
