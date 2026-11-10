# Aion Companion website

The project's landing page, built with TanStack Start, Tailwind CSS v4 and shadcn/ui (Base UI
style), checked with oxlint and formatted with oxfmt. Every page is prerendered to static HTML. It
is a separate package from the app; nothing here is bundled into the Windows build.

```bash
cd website
npm install
npm run dev        # http://localhost:3000
npm run check      # typecheck, oxlint, oxfmt --check
npm run build      # static output in dist/client
npm run sync:data  # refresh artwork and data from the app's bundle
```

`SITE_BASE` sets the public path for a sub-path host. The `Website` workflow checks and builds
the site on pull requests that touch it, and deploys `dist/client` to GitHub Pages (built with
`SITE_BASE=/<repository>/`) when such a change lands on `master`; it can also be run by hand. It
never releases the app. Pages must be set to deploy from GitHub Actions in the repository settings.

## Languages

The site comes in the app's two languages: English at `/` and Português (Brasil) at `/pt-br`.
Each is its own prerendered page with the right `lang`, `hreflang` alternates and localised meta,
and the EN | PT switch in the header is a plain link.

Every word lives in `src/i18n/en.tsx` and `src/i18n/pt.tsx`. The Portuguese dictionary is typed
against the English one, so a missing string fails the build. Labels inside the window copies use
the app's own strings (`frontend/src/i18n/locales/en` and `pt-BR`), and numbers and times use each
locale's format, as the app does.

## Without JavaScript

The page is complete without JavaScript. `<html class="no-js">` is swapped to `js` by one inline
line before the first paint (`src/routes/__root.tsx`). Without it, `styles.css`:

- lists every feature panel in order instead of the switcher;
- shows every FAQ answer;
- shows the map legend instead of its layer toggles;
- sizes the scaled game screens by breakpoint.

The Verteron chart is SVG, so it is in the static HTML. With JavaScript, the switcher, the
animated accordions, the live meter, the countdowns and the sky take over.

## Look

The page follows the app's one colour scheme (`frontend/src/styles/theme.css`,
`branding/palette.json`): a deep warm umber ground, parchment ink, warm hairlines and one gold
accent, with honey (pale gold) and ember (copper) as warm companions. No blue or violet appears
outside data colours, which use the app's data palette. Type is the app's own: Geist, with
headings set semibold and tight, and Geist Mono for figures.

A WebGL shader (`src/components/aether-sky.tsx`) draws warm aether currents, stars and rising
motes behind everything, and moves from a golden dawn to an ember dusk to umber night as you
scroll. It holds a still frame under reduced motion and falls back to a CSS gradient without
WebGL.

The page opens on a still game screen (`src/components/game-screen.tsx`): the app's windows laid
out where players keep them, with the headline in the middle where the game would be. A feature
switcher styled like the app's top menu shows one real window at a time
(`src/components/sections/showcase.tsx`). Then come the toolkit with a Companion stats window,
privacy and the questions. Installing is left to the app's own onboarding. Animation stays simple: fades, the live windows
and the sky. Nothing is driven by scrolling.

The in-game windows (`src/components/app`) are faithful copies of the app's own: the DPS meter,
party room, Timers, pet radar, top menu, alert popup and damage details, drawn with the app's
tokens (`--color-app-*` and the `text-2xs`/`3xs`/`4xs` scale in `styles.css`). When a window
changes in the app, update its copy here to match. To compare, use the app's browser preview
(`?view=overlay&mock`, `?view=timers&mock`, `?view=pet-radar&mock`, `?view=menu&mock`). The DPS meter
replays a real Atiel clear in Deus Research Base (`src/data/run.json`, made from a saved log by
`node scripts/extract-run.mjs <log>`). The extractor keeps only numbers, classes and timing; the
party (`src/data/party.ts`) keeps the developer's own character name, foxyyyynm, with permission,
and gives the other four players fictional names. Never publish other players' real names.

Every claim on the page must match the shipped app (README, `docs/`, bundled data), in both
languages. Counts such as 16,899 skills, 207 pets, 73 field bosses, 2,811 cube spots and 5,401
gathering points come from the bundled catalogues.

## Data

`npm run sync:data` copies the artwork the page shows from the app's verified bundle. It also
writes `src/data/game.json` and `src/data/verteron-atlas.json`, the cube and gathering placements
projected with the app's calibrated map transform. Rerun it when the app's data changes. Both
files are generated and excluded from formatting.

## Artwork

Class emblems, skill icons, pet portraits, pet type emblems and the Odyle icon in `public/art` are
copies of the verified originals the app ships (`frontend/public/game-art`, `pet-art`,
`pet-type-art`, `resource-art`); see [docs/GAME_ARTWORK.md](../docs/GAME_ARTWORK.md). They belong
to NCSOFT / NC Corporation and are not covered by the MIT licence. The Open Graph image in
`public/shots` is the README's demo-data capture. Do not add invented artwork; keep a written
label where an original is unavailable.
