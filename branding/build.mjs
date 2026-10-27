/** Hand-authored vector geometry. Tool dependencies live outside the checkout.
 * node branding/build.mjs <temporary-tool-directory>
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(root);
if (!process.argv[2])
  throw new Error('Pass a temporary directory containing @resvg/resvg-js and fontkit.');
const require = createRequire(path.join(path.resolve(process.argv[2]), 'package.json'));
const { Resvg } = require('@resvg/resvg-js');
const fontkit = require('fontkit');
fs.mkdirSync(path.join(root, 'export'), { recursive: true });
fs.mkdirSync(path.join(root, 'concepts'), { recursive: true });
const write = (file, data) => fs.writeFileSync(path.join(root, file), data);
// Björn Ottosson's published OKLab conversion matrices; round only at sRGB output.
function hex(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180),
    b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return (
    '#' +
    [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
      .map((v) =>
        Math.round(
          Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)) *
            255,
        )
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
const c = {
  gold: hex(0.83, 0.12, 82),
  sun: hex(0.89, 0.1, 88),
  ink: hex(0.94, 0.02, 85),
  dark: hex(0.155, 0.012, 70),
  surface: hex(0.2, 0.012, 70),
  raised: hex(0.28, 0.016, 72),
  umber: hex(0.36, 0.035, 65),
  paper: hex(0.86, 0.03, 88),
  muted: hex(0.72, 0.022, 80),
};
write('palette.json', JSON.stringify(c, null, 2) + '\n');
function svg(body, size = 64, title = 'AION Companion — Wayseed', extra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${title}" ${extra}>${body}</svg>\n`;
}
const vane = 'M10 36C5 23 14 8 29 7C39 6 49 11 54 20C41 17 28 20 23 30L17 41Z';
const seed = 'M32 25L36 32L32 39L28 32Z';
function wayseed(colors = [c.gold, c.sun, c.ink]) {
  return `<path fill="${colors[0]}" d="${vane}"/><path fill="${colors[1]}" d="${vane}" transform="rotate(180 32 32)"/><path fill="${colors[2]}" d="${seed}"/>`;
}
write('concepts/01-wayseed.svg', svg(wayseed()));
// Fieldfold: one folded trail-map leaf, its split becoming an oblique compass sight.
const fold = `<path fill="${c.gold}" d="M8 15L29 8L29 42L8 52Z"/><path fill="${c.sun}" d="M35 8L56 17L35 43Z"/><path fill="${c.ink}" d="M35 49L56 25L56 49L35 56Z"/>`;
write('concepts/02-fieldfold.svg', svg(fold, 64, 'AION Companion — Fieldfold'));
// Lantern: a hanging seed pod, with a rectangular aperture and an open stem.
const lantern = `<path fill="${c.gold}" fill-rule="evenodd" d="M29 6H35V12C46 17 53 26 53 37C53 49 43 57 32 59C21 57 11 49 11 37C11 26 18 17 29 12ZM25 28V44H39V28Z"/><path fill="${c.ink}" d="M28 17L32 13L36 17L32 22Z"/>`;
write('concepts/03-trail-lantern.svg', svg(lantern, 64, 'AION Companion — Trail Lantern'));
write('logo-mark.svg', svg(wayseed()));
write('logo-mark-mono.svg', svg(wayseed(['currentColor', 'currentColor', 'currentColor'])));
write('logo-mark-light.svg', svg(wayseed([c.umber, c.umber, c.umber])));
// Each tray size has its own integer / half-integer optical drawing, not a scaled master.
const hints = {
  16: {
    v: 'M3 9C1 5 4 2 7 2C10 1 12 3 13 5C9 4 6 5 5 8L4 10Z',
    seed: 'M8 6L9 8L8 10L7 8Z',
    rim: 1,
  },
  20: {
    v: 'M3 11C1 7 5 2 9 2C12 1 15 3 17 6C12 4 8 6 7 9L5 13Z',
    seed: 'M10 7L11.5 10L10 13L8.5 10Z',
    rim: 1.25,
  },
  24: {
    v: 'M4 13C2 8 6 3 11 3C15 2 19 4 20 7C15 5 10 7 8 11L6 15Z',
    seed: 'M12 9L13.5 12L12 15L10.5 12Z',
    rim: 1.5,
  },
  32: {
    v: 'M5 18C2 11 7 4 14 4C19 3 24 5 27 10C20 8 14 10 11 15L8 21Z',
    seed: 'M16 12L18 16L16 20L14 16Z',
    rim: 1.5,
  },
};
function hintBody(n, { outline = true, fill = c.gold } = {}) {
  const h = hints[n];
  const paths = `<path d="${h.v}"/><path d="${h.v}" transform="rotate(180 ${n / 2} ${n / 2})"/><path d="${h.seed}"/>`;
  return (
    (outline
      ? `<g fill="${c.surface}" stroke="${c.surface}" stroke-width="${h.rim}" stroke-linejoin="round">${paths}</g>`
      : '') + `<g fill="${fill}">${paths}</g>`
  );
}
for (const n of [16, 20, 24, 32]) {
  write(`tray-${n}.svg`, svg(hintBody(n), n, `AION Companion tray icon, ${n} pixels`));
  // Also supply the optical silhouette for inline currentColor use below 24px.
  write(`logo-mark-mono-${n}.svg`, svg(hintBody(n, { outline: false, fill: 'currentColor' }), n));
}
function tile(n, small = false) {
  const rim = n <= 24 ? 1 : n / 64;
  const r = n * 0.22;
  const ground = `<defs><linearGradient id="tile" x2="0" y2="1"><stop stop-color="${c.raised}"/><stop offset="1" stop-color="${c.dark}"/></linearGradient><linearGradient id="rim" x2="0" y2="1"><stop stop-color="${c.gold}" stop-opacity=".65"/><stop offset="1" stop-color="${c.gold}" stop-opacity=".18"/></linearGradient></defs><rect x="${rim / 2}" y="${rim / 2}" width="${n - rim}" height="${n - rim}" rx="${r}" fill="url(#tile)" stroke="url(#rim)" stroke-width="${rim}"/>`;
  const glyph = small
    ? hintBody(n, { outline: false })
    : `<g transform="translate(${n * 0.03} ${n * 0.03}) scale(${(n * 0.94) / 64})">${wayseed()}</g>`;
  return svg(ground + glyph, n, 'AION Companion application icon');
}
write('app-icon.svg', tile(256));
for (const n of [16, 20, 24, 32]) write(`app-icon-${n}.svg`, tile(n, true));
function raster(source, n) {
  return new Resvg(source, { fitTo: { mode: 'width', value: n } }).render().asPng();
}
const appSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024];
for (const n of appSizes) {
  const source = n <= 32 ? tile(n, true) : tile(256);
  write(`export/app-icon-${n}.png`, raster(source, n));
}
for (const n of [16, 20, 24, 32, 64])
  write(`export/tray-${n}.png`, raster(svg(hintBody(n === 64 ? 32 : n), n === 64 ? 32 : n), n));
write('export/favicon.svg', tile(16, true));
// PNG-compressed ICO directory: preserve every size's exact optical raster.
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 256];
const payloads = icoSizes.map((n) => fs.readFileSync(path.join(root, `export/app-icon-${n}.png`)));
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((n, i) => {
  const p = 6 + i * 16;
  header[p] = n === 256 ? 0 : n;
  header[p + 1] = header[p];
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(payloads[i].length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += payloads[i].length;
});
write('export/icon.ico', Buffer.concat([header, ...payloads]));
const fontPath = path.join(
  repo,
  'node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2',
);
const font = fontkit.openSync(path.join(path.resolve(process.argv[2]), 'instrument-sans-600.ttf'));
function outlines(text, x, y, size) {
  const run = font.layout(text);
  const scale = size / font.unitsPerEm;
  let cursor = x;
  return run.glyphs
    .map((glyph, i) => {
      const pos = run.positions[i];
      const d = glyph.path.toSVG();
      const out = `<path d="${d}" transform="translate(${(cursor + pos.xOffset * scale).toFixed(4)} ${(y - pos.yOffset * scale).toFixed(4)}) scale(${scale} ${-scale})"/>`;
      cursor += pos.xAdvance * scale;
      return out;
    })
    .join('');
}
const lockup = `<svg xmlns="http://www.w3.org/2000/svg" width="430" height="96" viewBox="0 0 430 96" role="img" aria-label="AION Companion"><g transform="translate(0 8) scale(1.25)">${wayseed()}</g><g fill="${c.ink}">${outlines('AION Companion', 104, 62, 38)}</g></svg>\n`;
write('logo-lockup.svg', lockup);
const asData = (text, mime = 'image/svg+xml') =>
  `data:${mime};base64,${Buffer.from(text).toString('base64')}`;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const img = (f, size, style = '') =>
  `<img alt="${f.replace(/.*\//, '').replace(/\.svg/, '')}" width="${size}" height="${size}" style="${style}" src="${asData(read(f))}">`;
const png = (f, n, zoom = 1) =>
  `<img alt="${f}" width="${n * zoom}" height="${n * zoom}" src="data:image/png;base64,${fs.readFileSync(path.join(root, 'export', f)).toString('base64')}" ${zoom > 1 ? 'style="image-rendering:pixelated"' : ''}>`;
const concepts = [
  ['01', 'Wayseed', 'Two windborne vanes shelter a compass seed.', 'concepts/01-wayseed.svg'],
  ['02', 'Fieldfold', 'A folded guide becomes a directional sight.', 'concepts/02-fieldfold.svg'],
  [
    '03',
    'Trail Lantern',
    'A seed pod holds a square of guiding light.',
    'concepts/03-trail-lantern.svg',
  ],
];
const trayStrip = (zoom) =>
  [16, 20, 24, 32]
    .map(
      (n) =>
        `<div class="sample">${png(`tray-${n}.png`, n, zoom)}<span>${n} px${zoom === 2 ? ' · 2×' : ''}</span></div>`,
    )
    .join('');
const mono = (n) =>
  read('logo-mark-mono-16.svg').replace('width="16" height="16"', `width="${n}" height="${n}"`);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AION Companion — identity study</title><style>
@font-face{font-family:Instrument;src:url(data:font/woff2;base64,${fs.readFileSync(fontPath).toString('base64')}) format('woff2');font-weight:400 700;font-display:block}
:root{color-scheme:dark;--gold:${c.gold};--ink:${c.ink};--muted:${c.muted};--dark:${c.dark};--surface:${c.surface};--raised:${c.raised}}
*{box-sizing:border-box}html,body{margin:0;background:var(--dark);color:var(--ink);font-family:Instrument,sans-serif}main{max-width:1160px;margin:auto;padding:44px 40px}h1{font-size:38px;letter-spacing:-1.2px;margin:8px 0 12px;line-height:1.1}h2{font-size:20px;margin:0 0 6px;letter-spacing:-.3px}p{font-size:14px;line-height:1.55;color:var(--muted);margin:0}small,.eyebrow{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold)}header{display:flex;justify-content:space-between;align-items:end;gap:24px;padding-bottom:32px}header p{max-width:330px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{border:1px solid #ffffff16;border-radius:18px;background:var(--surface);padding:24px}.card.selected{border-color:${c.gold}88}.concept-art{height:144px;display:flex;align-items:center;justify-content:center;margin-bottom:18px}.card h2{margin:10px 0 8px}.badge{border:1px solid ${c.gold}66;color:var(--gold);border-radius:20px;padding:4px 8px;font-size:10px;letter-spacing:.8px}.line{display:flex;align-items:center;justify-content:space-between}section{margin-top:30px}.section-title{margin-bottom:14px;display:flex;justify-content:space-between;align-items:baseline;gap:16px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.stage{min-height:192px;display:flex;align-items:center;justify-content:center;position:relative;border-radius:18px;padding:30px;background:var(--surface);border:1px solid #ffffff16}.stage.light{background:${c.paper};color:${c.umber}}.stage .label{position:absolute;top:16px;left:18px;font-size:11px;opacity:.65}.lockup{margin-top:16px;min-height:126px}.lockup img{max-width:100%;height:auto}.trayboard{border-radius:18px;overflow:hidden;border:1px solid #ffffff16}.taskbar{background:#20201f;padding:16px 20px;display:flex;align-items:center;justify-content:space-around;gap:10px;min-height:87px}.taskbar.light{background:#e6e4e0;color:#36312b}.taskbar.light span{color:#51483d}.sample{display:flex;flex-direction:column;align-items:center;gap:10px;min-width:45px}.sample span{font-size:10px;color:var(--muted);white-space:nowrap}.zoom .taskbar{min-height:120px}.topbar{display:flex;align-items:center;gap:22px;justify-content:center;padding:26px 12px;border-radius:18px;background:radial-gradient(at 20% 0%,${c.gold}13,transparent 80%),var(--surface);border:1px solid #ffffff16}.pill{display:flex;align-items:center;gap:8px;border-radius:999px;border:1px solid ${c.gold}44;padding:7px 12px;background:${c.dark}b3;color:var(--gold);font-size:12px}.pill svg{display:block;flex:none}.pill span{color:var(--ink)}.desktop{margin-top:16px;padding:24px 24px 0;border-radius:18px;background:radial-gradient(ellipse at 65% 0%,#5f5a3b,#282820 70%);overflow:hidden}.desktop-note{height:66px;color:${c.ink}aa;font-size:12px}.windowsbar{display:flex;gap:18px;align-items:center;justify-content:center;background:#1d1c1be6;margin:0 -24px;padding:10px 24px;border-top:1px solid #ffffff16}.windows-icon{position:relative;display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:6px;background:#ffffff09}.windows-icon.active:after{content:'';position:absolute;width:16px;height:3px;background:var(--gold);border-radius:3px;bottom:-4px}.windows-glyph{display:grid;grid-template-columns:repeat(2,6px);gap:2px}.windows-glyph i{width:6px;height:6px;background:${c.ink}99}.search{width:105px;border:1px solid #ffffff18;border-radius:20px;font-size:11px;color:var(--muted);padding:8px 12px}.note{margin-top:14px;font-size:12px}.sizes{display:flex;align-items:end;gap:24px;flex-wrap:wrap;margin-top:16px;padding:24px;border-radius:18px;background:var(--surface)}footer{display:flex;justify-content:space-between;gap:20px;margin-top:28px;border-top:1px solid #ffffff16;padding-top:18px;font-size:11px;color:var(--muted)}
@media(max-width:700px){main{padding:24px 16px}header{display:block}header p{margin-top:14px}.grid{grid-template-columns:1fr}.concept-art{height:100px}.pair{grid-template-columns:1fr}.topbar{gap:10px;flex-wrap:wrap}.section-title{display:block}.section-title p{margin-top:6px}h1{font-size:30px}.search{display:none}footer{display:block}}
</style></head><body><main><header><div><div class="eyebrow">Original identity / 01</div><h1>A companion, carried with you.</h1><p>AION Companion · Windows desktop identity</p></div><p>Three original vector directions for a living field guide. Built from filled geometry and tested from the system tray upward.</p></header><div class="grid">${concepts.map(([n, name, desc, f]) => `<article class="card ${n === '01' ? 'selected' : ''}"><div class="line"><small>${n} / Concept</small>${n === '01' ? '<b class="badge">RECOMMENDED</b>' : ''}</div><div class="concept-art">${img(f, 112)}</div><h2>${name}</h2><p>${desc}</p></article>`).join('')}</div>
<section><div class="section-title"><h2>Wayseed</h2><p>Two vanes. One bearing. A mark for the whole companion.</p></div><div class="pair"><div class="stage"><span class="label">Gold / warm dark</span>${img('logo-mark.svg', 136)}</div><div class="stage light"><span class="label">Umber / parchment</span>${img('logo-mark-light.svg', 136)}</div></div><div class="stage lockup"><span class="label">Instrument Sans · outlined</span><img alt="AION Companion outlined lockup" width="430" height="96" src="${asData(lockup)}"></div></section>
<section><div class="section-title"><h2>System tray · actual pixels</h2><p>Gold silhouette, warm-dark keyline. Same asset on both surfaces.</p></div><div class="pair"><div class="trayboard"><div class="taskbar">${trayStrip(1)}</div><div class="taskbar light">${trayStrip(1)}</div></div><div class="trayboard zoom"><div class="taskbar">${trayStrip(2)}</div><div class="taskbar light">${trayStrip(2)}</div></div></div><p class="note">Left: 1 image pixel = 1 CSS pixel. Right: nearest-neighbour 2× inspection. Curves are antialiased; anchors, extrema and the seed are optically fitted per size.</p></section>
<section><div class="section-title"><h2>In-game & desktop</h2><p>One colour in the top bar; a warm tile on Windows.</p></div><div class="topbar">${[14, 16, 18].map((n) => `<div class="pill">${mono(n)}<span>AION Companion</span><small style="font-size:9px;letter-spacing:0">${n}px</small></div>`).join('')}</div><div class="desktop"><div class="desktop-note">Windows-like taskbar · active application</div><div class="windowsbar"><div class="windows-icon"><div class="windows-glyph"><i></i><i></i><i></i><i></i></div></div><div class="search">Search</div><div class="windows-icon active">${png('app-icon-32.png', 32)}</div><div style="width:90px"></div>${png('tray-16.png', 16)}<span style="font-size:11px;color:${c.ink}b0">19:24</span></div></div><div class="sizes">${[16, 20, 24, 32, 48, 64, 128].map((n) => `<div class="sample">${png(`app-icon-${n}.png`, n)}<span>${n} px</span></div>`).join('')}</div></section><footer><span>Wayseed / hand-built SVG geometry · no game artwork</span><span>Gold ${c.gold.toUpperCase()} · Instrument Sans</span></footer></main></body></html>`;
write('preview.html', html);
const license = path.join(repo, 'node_modules/@fontsource-variable/instrument-sans/LICENSE');
if (fs.existsSync(license)) write('Instrument-Sans-LICENSE.txt', fs.readFileSync(license));
// A quick raster contact sheet for inspecting the geometry before the browser proof.
const contact = svg(
  `<rect width="768" height="768" fill="${c.dark}"/><g transform="translate(40 40) scale(3)">${wayseed()}</g><g transform="translate(288 40) scale(3)">${fold}</g><g transform="translate(536 40) scale(3)">${lantern}</g>${[16, 20, 24, 32].map((n, i) => `<g transform="translate(${48 + i * 180} 300) scale(4)">${hintBody(n)}</g>`).join('')}`,
  768,
);
write('export/geometry-proof.png', raster(contact, 768));
console.log('Created vector kit, outlined wordmark, PNG/ICO exports and self-contained preview.');
console.log(c);
