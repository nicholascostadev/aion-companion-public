# Design system

One token system, one set of primitives and one stylesheet for every window of AION Companion:
the workspace and every in-game overlay. Tailwind CSS v4 is the styling engine. This page is the
contract every screen follows; `npm run check` enforces the parts a script can see (see
Guardrail).

## Direction: a living field guide

The app is a naturalist's field guide to Atreia, read at dusk: precise and dense like a good
reference, but warm and alive like the world it describes. The world is huge and full of life,
so the interface is light falling through leaves, not a wall of boxes.

- **One scheme: warm dark gold glass.** Every window, the workspace and the in-game overlays,
  wears the same colours: a deep warm umber ground (not slate), warm parchment ink (not
  blue-white), warm hairlines and one **gold** accent (sunlight, honey, firefly glow), which reads
  well over the game and on the desktop alike. The only difference between windows is
  translucency: in-game windows are glass over the game, the workspace is solid (see One scheme,
  glass or solid).
- **Light from above.** Surfaces carry a faint highlight on their top edge and a long, soft shade
  below (`shadow-*`, `inset-shadow-light`), as if lit through a canopy. The workspace ground
  itself is flat.
- **Flat surfaces, no glows.** Decorative gradients are not used: no ambient pools or glows, no
  sheen washes on cards, no gradient rules or bars. Surfaces, tints, lines and fills are solid
  tokens (opacity modifiers are fine). A gradient is used only where it encodes information
  (hatching over an unobserved span, a ruled grid, a cooldown sweep, a paper texture, an alpha
  mask that fades line art out).
- **Terrain, not wallpaper.** Faint topographic contour lines (`assets/contours.svg`, generated,
  not game art) drift behind the top of the workspace, faintly gold, and fade out before the data starts. A
  whisper of grain keeps large surfaces from reading as plastic. Decoration never sits behind
  dense data.
- **Pebbles and leaves.** Things you press are pebbles: fully rounded buttons, chips, segments and
  switches. Things that hold content are leaves and stones: soft-cornered panels (`rounded-xl`,
  `rounded-lg`). The original Wayseed brand mark sits in a leaf shape (`rounded-leaf`): two
  windborne vanes shelter a compass seed. Master artwork and optical tray-size drawings live in
  `branding/`; the inline `BrandMark` inherits the accent colour.
- **One face.** Instrument Sans is the only typeface, in every window: headings, the brand and
  hero figures in semibold with slightly tight tracking; every label, control and table with
  true tabular figures. Weight and size carry the hierarchy, not a second face.
- **Things grow, settle and breathe.** Selected tabs grow a small stem from their centre, switches
  settle with a slight spring, panels fade in, live indicators breathe slowly. Motion is short and
  disabled under `prefers-reduced-motion`, except the loading spinner (see Motion).

What it is not: no invented artwork that could pass for game art, no decorative motifs behind
tables, maps or meters, and no colour used as the only signal.

## Files

| File                                | Role                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `frontend/src/styles/index.css`     | The only stylesheet entry (imported once, by `main.tsx`). Declares the cascade layers and imports.  |
| `frontend/src/styles/theme.css`     | Every token (`@theme`), the raw light and shade values, and the glass and deep-glass blocks.        |
| `frontend/src/styles/base.css`      | Element defaults on top of Preflight; the workspace ground; transparent overlay windows.            |
| `frontend/src/styles/utilities.css` | The few custom utilities (`text-halo`, `text-halo-strong`, `bg-hatch`, `bg-ruled`, `bg-parchment`). |
| `frontend/src/components/ui/*`      | The primitives.                                                                                     |
| `frontend/src/lib/cn.ts`            | `cn()`: clsx + tailwind-merge, taught the custom scales.                                            |
| `scripts/check-design-system.mjs`   | The guardrail run by `npm run check` (see Guardrail).                                               |
| `components.json`                   | The shadcn CLI's configuration: Base UI style, `@/` aliases (see Base UI and owned primitives).     |

There are no other stylesheets: every screen and every in-game window is styled with utilities
and primitives only.

### Cascade layers

`@layer theme, base, components, utilities;`

Tailwind Preflight and the element defaults sit in `base`; utilities always win over them,
because layer order (not selector specificity) decides. Never import CSS from a component file:
an unlayered or out-of-order stylesheet breaks this ordering. Never use `!important` to win a
fight; fix the rule that loses.

Preflight resets some browser defaults (lists lose bullets and padding, headings inherit size,
images and SVGs become `display: block`, buttons lose their chrome). The base layer restores
headings, paragraphs, tables, `<kbd>` and the like; everything with a look of its own is a
primitive.

## Tokens

All tokens live in `theme.css`. Tailwind's stock colours, type sizes, radii, shadows and easings
are cleared, so only these names exist as utilities. Never write a hex, `rgb()`, `oklch()` or
pixel font size in a component; if a value is missing, add a token here first. The guardrail
rejects colour literals anywhere else.

Besides the colour roles, `theme.css` holds a few raw values of light and shade that generate no
utilities and are read only by `base.css` and `utilities.css`: `--light-hatch`, `--halo`,
`--halo-strong` and the solid surface steps (`--solid-surface` … `--solid-veil`) that the
surface roles point at.

### Colour roles

| Role       | Utilities (examples)                                    | Use                                                                                    |
| ---------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Ground     | `bg-canvas`                                             | Page background (workspace only; transparent in overlays).                             |
| Surfaces   | `bg-surface`, `bg-surface-2`, `bg-surface-3`            | Raised panel, nested block, control fill.                                              |
|            | `bg-surface-hover`, `bg-sunken`, `bg-veil`, `bg-scrim`  | Hover fill, wells and inputs, sticky bars, modal scrim.                                |
| Lines      | `border-line-soft`, `border-line`, `border-line-strong` | Hairlines inside panels, panel edges, control edges.                                   |
| Ink        | `text-ink`, `text-ink-2`, `text-ink-3`, `text-ink-4`    | Primary, secondary, muted, faint/disabled text.                                        |
|            | `text-ink-inverse`                                      | Text on a solid light fill.                                                            |
| Accent     | `accent`, `accent-strong`, `accent-soft`, `accent-line` | Selection, primary action, focus, live state.                                          |
|            | `accent-ink`                                            | Text and icons on a solid accent fill.                                                 |
| Status     | `success`, `warn`, `danger`, `info`                     | Reserved for state. Each has `-strong`, `-soft`, `-line`.                              |
| Table rows | `bg-row-hover`, `bg-row-selected`, `-selected-solid`    | Row wash; the solid variant is for sticky cells.                                       |
| Shade      | `bg-shade/80`, `bg-shade/95`, `bg-shade/(--pet-alpha)`  | Opaque ground, always with an alpha: deep glass, floating menus, user-set see-through. |
| Focus      | `outline-focus`                                         | The focus ring colour (see `focusRing` in `Button.tsx`).                               |
| Paper      | `bg-paper`, `text-paper-ink`, `stroke-paper-line`       | The parchment of maps: the original art's margin tone, its umber pen, graticule.       |

Soft variants are tints for backgrounds, line variants are borders, the base value is for text
and icons, strong is for hover and emphasis.

### One scheme, glass or solid

There is one colour scheme, the in-game look, for every window. Every role (`accent`, ink, lines,
status, markers) has one value, declared once in `@theme`, so components say `bg-accent` or
`text-ink-3` and look the same everywhere. There is no scheme switch and no per-window colour
branching; never re-declare a colour role for a subtree.

What differs is translucency, because of where a window lives:

- **Solid** (the workspace, an ordinary opaque desktop window): `bg-canvas` is the warm umber
  ground and the surface roles point at the solid steps (`--solid-surface` …).
- **Glass** (every in-game window: overlay, menu, group, trackers, details, alert-popup,
  pet-radar). `main.tsx` sets `data-surface="glass"` on `<html>` for them, and that one block
  turns only `canvas` (transparent), the surfaces, `sunken` and `veil` translucent. Colours,
  ink and type do not change.
- **Deep glass** (`data-glass="deep"`, the damage details report): a glass subtree whose
  surfaces point back at the solid steps, so sticky table cells and stacked layers never let
  the game or scrolled content show through.

Contrast on the solid surface: `ink` 15:1, `ink-2` 11:1, `ink-3` 7.3:1 (AAA, so the muted
columns of dense tables stay readable), `ink-4` 4.6:1 (AA, faint and disabled text); the
accent is 10.6:1 and `accent-ink` on a solid accent fill 9.7:1. `warn` is amber turned towards
orange so it never reads as the gold accent (OKLab ΔE 7, where a honey warn would be 2).

Overlay glass must keep the game visible: surfaces are around 55–65% opaque, text keeps full
opacity and gets `text-halo` for legibility. Windows that are read rather than glanced at use
**deep glass** (`bg-shade/80` and up, see Overlay patterns). Overlay windows have no page
background at all; the body and root are transparent and never scroll (`base.css`).

### Data colours

One nature palette, fixed order, for marks only (bars, dots, lines, swatches). The mark steps are
exactly `seriesColors` in `lib/format.ts`, validated for this dark ground (adjacent CVD ΔE ≥ 8.4,
≥ 3.6:1 against the surface); `styles/theme.test.ts` keeps the two in sync.

**Pollen is the gold of the data palette.** As a mark it sits well apart from the gold accent
(simulated ΔE ≥ 15.9 for every vision type, mostly by lightness), but its label step
`pollen-ink` is the accent's twin. So pollen only ever names data (a family, a category, a buff,
a faction) with its word or symbol beside it, and never a UI state: selection, progress, pins
and focus are the accent or their own roles.

| Slot | Name   | Mark        | Label step        |
| ---- | ------ | ----------- | ----------------- |
| 1    | sky    | `bg-sky`    | `text-sky-ink`    |
| 2    | ember  | `bg-ember`  | `text-ember-ink`  |
| 3    | jade   | `bg-jade`   | `text-jade-ink`   |
| 4    | pollen | `bg-pollen` | `text-pollen-ink` |
| 5    | berry  | `bg-berry`  | `text-berry-ink`  |
| 6    | fern   | `bg-fern`   | `text-fern-ink`   |
| 7    | iris   | `bg-iris`   | `text-iris-ink`   |
| 8    | rose   | `bg-rose`   | `text-rose-ink`   |

Domain aliases point into it, so every feature shares one palette:

- Pet families: `family-cognia` (berry), `family-fera` (ember), `family-natura` (fern),
  `family-varia` (sky), `family-specia` (pollen), `family-unknown`. Iris is deliberately left
  to no family.
- Player classes: `class-gladiator`, `class-templar`, `class-ranger`, `class-assassin`,
  `class-spiritmaster`, `class-sorcerer`, `class-cleric`, `class-chanter`, `class-brawler`, and
  `class-unknown` (ink-4) for a class that is unknown or hidden. These are their own mark values
  rather than aliases of the data palette (see Class colours).
- Alert categories (label steps): `alert-event` (jade), `alert-world` (rose), `alert-field`
  (pollen), `alert-custom` (sky).
- Map markers, the same in every window: `marker-goal` is the gold accent (`@theme inline`),
  `marker-pinned` the sky label step (cool water-blue, away from the gold) and `marker-live`
  the iris mark (the hue no family uses, so a live mark never reads as a spawn).
  `marker-selected` is ink. The three are ≥ 14 apart in simulated ΔE for protan, deutan and
  tritan vision, and each also has its own shape.
  Cubes are drawn with the original Hidden Cube artwork (`CubeIcon` / `cubeArtSrc` in
  `GameArt.tsx`), never recoloured; the casing under it tells the state. A received cube sits
  on a `marker-live` diamond (`warn` while opening, a smaller dashed paper diamond and faded
  art once seen earlier) and ripples when new. `marker-possible` uses the iris label step for
  static possible locations: the cube on a dark round plate with a dashed ring and no ripple.
  Count tags (the cube and a number) group these places as the map zooms out; received cube
  diamonds remain above them and have separate selection and lifecycle details.
  Gathering locations use the same dashed possible-location plate with each resource's
  verified original item icon, or its written short name when no original is available.
  One combined layer clusters resources together; count tags show at most two overlapped
  resource glyphs and merge with neighbouring tags when they overlap. Neither gathering
  places nor their tags use a live-state colour, ripple or timer.
  The Explore workspace clusters all visible static layers together. Mixed tags keep the
  cube and resource glyphs, a total count and each layer's represented count; switching
  layers preserves the shared camera. Live observations remain above static tags.
  The player uses the Pets facing arrow and shared bounded motion model. Estimated
  positions have a dashed displacement ring and an estimate chip; a last-known position
  is hollow and dashed. These display cues never supply measured distances. The in-game
  Explore map follows the player and offers zoom controls; the workspace keeps browsing.

**Class colours.** A player's class decides their mark colour, through the pure `classColor`
(`lib/classColors.ts`): every player of a class gets the same `class-…` token, for every user, in
every window and every fight, whatever their rank or whether they are the local player. Native
spellings are normalised and the game's own internal names map to their class (Elementalist is
the Spiritmaster, Fighter the Brawler); anything else is `class-unknown`. The meter's damage bars
and a player's skill bars, the live table's swatches and share meters, Compare and every report
view use the same mapping. A hidden local player's class is not used, so the colour never gives
it away. The palette is an application design choice, not one NCSOFT defines; its provenance is
in `docs/CLASS_COLORS_RESEARCH.md`. Class colours are `var(--color-…)` strings for DOM marks
(bars, swatches, meters), not canvas values. Players of one class share a colour and several
classes sit close for colour-blind vision, so the name and class emblem always sit beside the
mark.

Rules: players take colours by class, never by rank or person. Values and names are
written in ink, with the colour beside them as a swatch or mark. Family and alert colours never
stand alone: a family always shows its original type symbol and name, an alert its category word.
Families are compared pairwise on maps, so they were checked against all pairs, not only
neighbours. Cognia is berry rather than iris because iris against Varia's sky is
nearly identical for protan and deutan vision (simulated ΔE 1.9 / 5.9; berry against sky is
15.9 / 18.6). One weak pair remains, Fera (ember) against Natura (fern) for protan vision (2.7):
the palette has no better slot for either, which is one more reason the symbol and name are
mandatory and the map legend always shows them. Canvas drawing reads the same values from
`lib/format.ts` (or `getComputedStyle` for roles), never from new literals.

### Type

| Token / utility | Size | Use                                                                |
| --------------- | ---- | ------------------------------------------------------------------ |
| `text-4xs`      | 9px  | Caps over dense overlay columns only (the meter head, rank seeds). |
| `text-3xs`      | 10px | Overlay micro labels only.                                         |
| `text-2xs`      | 11px | Caps labels, hints, table headers, tags.                           |
| `text-xs`       | 12px | Secondary UI text, chips, small buttons.                           |
| `text-sm`       | 13px | Default control and table text.                                    |
| `text-base`     | 14px | Body (the `<body>` default).                                       |
| `text-md`       | 15px | Emphasised body.                                                   |
| `text-lg`       | 18px | `h2`, card titles.                                                 |
| `text-xl`       | 22px | Section titles, report stats.                                      |
| `text-2xl`      | 28px | Hero figures (live stat strip).                                    |
| `text-3xl`      | 36px | Reserved for a single headline figure.                             |

Families: `font-sans` (Instrument Sans Variable, the only typeface) and `font-mono` (system
Cascadia/Consolas, for paths and codes). The sans is bundled locally from
`@fontsource-variable/instrument-sans` (OFL, see `THIRD_PARTY_NOTICES.txt`); the app never
fetches fonts.

- Headings are the sans: `h1`/`h2` semibold with `tracking-tight` by default, `h3` and below
  semibold. Titles styled by hand (card titles, empty states, hero names) use
  `font-semibold tracking-tight`; there is no display face.
- **One heading ladder per view.** The first heading inside a workspace tab is an `h2`: a page
  `Section` title (`text-xl`: Alerts, Pets, Replay) or, in tabs without one, the card and
  chapter titles themselves (`text-lg`). Cards under a page `Section` drop to `h3` with the same
  look (`Card level={3}`). Caps sub-labels inside a card are the next level down. Never skip a
  level to get a smaller size; restyle the right level instead.
- Figures that can change or align (tables, meters, timers, hero stats) use `tabular-nums`.
- Caps labels: `text-2xs font-semibold tracking-caps uppercase text-ink-3`.
- Tracking: `tracking-tight` for headings and hero figures, `tracking-wide`, `tracking-caps`.

### Space, size and shape

- Spacing is Tailwind's 4px scale (`p-1` = 4px … `p-5` = 20px). Panels pad `p-4` or `p-5`,
  controls sit `gap-2`, sections are `mt-8` apart.
- Layout: `max-w-workspace` (1320px) for the workspace column, `h-header`/`top-header` for the
  sticky bar.
- Radii: `rounded-xs` 3px (tags, checkboxes, swatches, `kbd`), `rounded-sm` 6px, `rounded-md`
  9px (inputs, dense overlay rows), `rounded-lg` 12px (nested blocks, tables, popovers, rows),
  `rounded-xl` 16px (cards and window roots), `rounded-2xl` 22px, `rounded-full` (everything
  pressable), `rounded-leaf` (brand mark, rare accents). Only these: arbitrary radii
  (`rounded-[5px]`) fail the guardrail; `rounded-[inherit]` is the one exception.
- **Corners nest concentrically.** A shape inside another follows its curve: the inner radius is
  the outer radius minus the border and the gap between them, rounded to the nearest token
  (outer = inner + gap). A pet card (`rounded-lg`, 1px border, `p-1.5`) holds a `rounded-sm`
  portrait (12 − 1 − 6 ≈ 6); the 32px menu pill holds 28px pill buttons. Where the gap is as
  large as the outer radius (a card's `p-4`/`p-5`), any smaller token reads as nested. A shape
  flush against its parent's edge takes the parent's radius (`rounded-[inherit]`).
- **Nested blocks step down.** A block inside a card is never as round as the card: hand-rolled
  surfaces inside a `raised` panel use `rounded-lg`, like `Panel variant="flat"`; only cards,
  window roots and free-floating cards on the ground are `rounded-xl`. Art inside a card stays at
  or below the card's radius.

### Elevation

`shadow-1` (controls), `shadow-2` (cards), `shadow-3` (popovers, floating panels, the save bar), `shadow-glow`
(an accent halo, resolved where used), `inset-shadow-light`. Overlays use
glass and a text halo instead of heavy shadows.
`inset-shadow-well` presses a shallow well into the ground: inputs (`controlClasses`), the
fight-overview track and the cast lane.

### Focus

Every interactive element shows a 2px `outline-focus` ring offset by 2px on `:focus-visible`
(the base layer applies it globally; primitives export `focusRing`). Never remove an outline
without replacing it.

### Motion

Easings `ease-grow` (default, decelerating), `ease-spring` (slight overshoot, switches and
checks), `ease-sway` (breathing). Durations: 150ms for colour, 200–300ms for movement. Animations:
`animate-breathe` (live dots), `animate-grow` (a bar or mark growing out from its root once, when
it first appears; pair it with `origin-left`), `animate-sprout` (panel fade-in; opacity only, so it never traps
`position: fixed` children), `animate-ripple` (a ring spreading out from something live on a
map, like a ripple on water; on SVG pair it with `origin-center [transform-box:fill-box]`),
`animate-alight` (something arriving from above and settling, like a leaf: alert cards, pickup
toasts, the tracker arrange card), `animate-spin` (loading). All motion collapses under
`prefers-reduced-motion` except `animate-spin`: a frozen loader reads as stalled work, and
Windows reports reduced motion whenever its animation effects are off.

`text-halo-strong` (utility) is a heavier halo for figures printed over game art (tracker
timers on skill icons).

`bg-parchment` (utility) is the paper of a map without art: `paper` with a faint shade toward
the edges and a whisper of umber fibre. Paper texture only, never terrain.

## Primitives

Import from `frontend/src/components/ui/<File>`. The interactive primitives are built on Base UI
(`@base-ui/react`) and owned here, the shadcn way (see Base UI and owned primitives). Every
primitive accepts `className`, merged with
`cn()` so a later utility overrides a default (`<Button className="px-0">`). Every element a
primitive renders carries `data-ui`, a stable hook for tests. A native `<button>` only exists
inside `components/ui`.

| Primitive                                                                           | File                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`, `buttonClasses()`, `focusRing`                                            | `Button.tsx`           | Base UI `Button` (a native `<button>`). `variant` primary · secondary · ghost · danger · link; `size` 2xs (dense overlay toolbars only) · xs · sm · md; `iconOnly` (needs `aria-label`); `icon`; `loading` (spinner, `aria-busy`, blocks clicks). `aria-pressed` turns secondary/ghost into a lit toggle. The button sizes its Lucide glyphs itself (2xs 11 · xs 12 · sm 14 · md 15 px), whatever size the caller passes. Defaults to `type="button"`; it is also the `render` of Base UI triggers (`MenuTrigger`, `CollapsibleTrigger`).                                                                                                                                                                                                                                                             |
| `Pressable`, `selectableRow()`                                                      | `Pressable.tsx`        | Base UI `Button`. A whole row, card or mark that is itself the click target (a log in the library, a pet card, a meter row, a cast on the vine). Only pointer, left alignment, focus ring and disabled dimming: the caller draws the surface and gives it a hover and a selected state. `selectableRow(selected)` is the quiet row that lights with `bg-row-selected` and grows an accent stem. Defaults to `type="button"`.                                                                                                                                                                                                                                                                                                                                                                          |
| `WindowSwitch`                                                                      | `WindowSwitch.tsx`     | Show/hide switch for an in-game window: its icon and name, a switch track and the state word the native side reports (Shown, Hidden, Auto-hidden, Checking…). Base UI `Switch` rendered as a native `<button>` (`role="switch"`, `aria-checked` from `on`); the caller's `onClick` asks native for the change. `busy` sets `aria-busy`. Used for the DPS meter (`DpsToggle`), the tracker bars and the pet radar.                                                                                                                                                                                                                                                                                                                                                                                     |
| `Chip`                                                                              | `Chip.tsx`             | Filter/quick toggle pill. With `pressed` + `onPressedChange` it is Base UI `Toggle` (`aria-pressed`); without, a plain Base UI `Button`. `icon`, `count`, `size` xs · sm.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SegmentedControl`                                                                  | `SegmentedControl.tsx` | One of a few: Base UI `ToggleGroup` of `Toggle`s, a group named by `label` with `aria-pressed` segments. One tab stop; the arrow keys, Home and End move between segments and Enter or Space chooses; pressing the chosen one keeps it. `size` xs (overlay toolbars) · sm · md; `segmentAttributes` puts data attributes (`data-hit`) on every segment.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Tabs`, `TabList`, `TabPanel`                                                       | `Tabs.tsx`             | Base UI `Tabs`. `Tabs` (`value`, `onValueChange`) holds the choice and links list and panels (ids, `aria-controls`, `aria-labelledby`) while laying out nothing (`display: contents`), so the list can sit in a sticky nav above `main`. `TabList` (`items`, `label`, `badge`, `variant` primary · sub): one tab stop, the arrow keys, Home and End choose as they move; a disabled tab can be focused and read but never chosen. `TabPanel value` unmounts while hidden unless `keepMounted` (then `hidden`), and stays out of the tab order.                                                                                                                                                                                                                                                        |
| `Field`                                                                             | `Field.tsx`            | Base UI `Field`: label + `children(id)` + hint or announced error (`role="alert"`); `wide` spans a form grid. The label points at `id`; a Base UI control inside (`Input`, `Checkbox`, `Switch`) is also described by the hint or error and gets `aria-invalid` from `error`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Input`, `Textarea`, `Select`                                                       | `Field.tsx`            | Sunken wells; `size` sm · md; `aria-invalid` turns the edge red. `Input` is Base UI `Input` (native `<input>`, native `onChange`); one named by its own `aria-label` keeps that name inside a `Field`. `Textarea` and `Select` stay native, like shadcn's `Textarea` and `NativeSelect`: the OS list keeps type-ahead and opens past the edge of a small in-game window. `Select` has a chevron and takes `<option>` children.                                                                                                                                                                                                                                                                                                                                                                        |
| `SearchInput`                                                                       | `Field.tsx`            | An `Input type="search"` led by a magnifier; name it with `aria-label`; `wrapperClassName` takes width and layout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Checkbox`                                                                          | `Field.tsx`            | Base UI `Checkbox`: a `role="checkbox"` box with a hidden native input for forms; optional `label` and `hint`. Read changes from `onCheckedChange(checked)`; `indeterminate` reports `aria-checked="mixed"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Switch`, `SwitchTrack`                                                             | `Field.tsx`            | Immediate on/off: Base UI `Switch` (`role="switch"`) drawn as the track and thumb, `checked` + `onCheckedChange`. `label` is optional: without it only the track shows, for a switch leading a list row (give it an `aria-label`). `SwitchTrack` is the decorative track for a control that already is the switch (`WindowSwitch`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Badge`, `StatusDot`                                                                | `Badge.tsx`            | `tone` neutral · accent · success · warn · danger · info; `variant` soft · outline · solid; `shape` pill · tag; `dot` (or `'live'` to breathe). Hotkeys are a plain `<kbd>`, styled in `base.css`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Panel`, `PanelHeader`, `Card`, `Section`                                           | `Panel.tsx`            | `Panel variant` raised · flat · inset · glass (see-through, haloed text), `padding`, `as`. `Card` = raised panel + header (`level` 2 · 3, same look). `Section` = titled page group (`h2`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Stat`, `StatStrip`, `Meter`, `Swatch`                                              | `Data.tsx`             | Hero figures; a stat strip (`variant` boxed · open, `columns` 2–6 · auto: as many columns as the strip's own width allows, always in balanced rows, so five figures wrap 3 + 2 and never leave one alone); a fill bar (`size` xs · sm · md, grows in once; `fraction` null = hatched unknown); a colour key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `BarList`, `KeyValueList`                                                           | `Data.tsx`             | Ranked names with aligned growing bars and values (rows share one subgrid); a two-column list of labelled facts that skips falsy entries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Disclosure`                                                                        | `Disclosure.tsx`       | Base UI `Collapsible` with a turning chevron: the summary is a button (`aria-expanded`, `aria-controls`), the closed body stays in the page as `hidden="until-found"` so find-in-page opens it. `variant` rule (hairline above) · plain; `open` sets the state like `<details open>` (a new value re-applies it, the reader can fold it in between); `summaryClassName` and `summaryAttributes` (e.g. `data-hit`) for the summary row.                                                                                                                                                                                                                                                                                                                                                                |
| `Collapsible`, `CollapsibleTrigger`, `CollapsiblePanel`                             | `Collapsible.tsx`      | Base UI `Collapsible` parts without a look, for a trigger and panel that already have one in their screen (a map's boss list, an alert row's options): `render` keeps the element the screen uses (`render={<li />}`, `render={<Button … />}`), `open` + `onOpenChange` keep the screen's own state. The panel unmounts while closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Menu`, `MenuTrigger`, `MenuPopup`, `MenuRadioGroup`, `MenuRadioItem`               | `Menu.tsx`             | Base UI `Menu`: a trigger (`aria-haspopup`, `aria-expanded`; `render={<Button … />}`) and a floating list of deep glass with an accent edge. Arrow keys and type-ahead move, Escape and an outside press close and give focus back to the trigger. `MenuPopup` takes `container` (an in-game window mounts it inside its root, so it keeps the window's zoom and its `data-hit` items stay clickable), `anchor`, `side`, `align` and offsets. `MenuRadioItem` is a `menuitemradio` lit with the accent when checked. Used by the meter's History.                                                                                                                                                                                                                                                     |
| `HoverCard`, `useHoverCard()`, `placeHoverCard()`                                   | `HoverCard.tsx`        | A small floating card of facts about the mark under the pointer or focus (map marks; reusable for chart points). Informational only: `role="tooltip"`, never takes the pointer, holds nothing to click. Portalled over everything, kept in the window (preferred `side`, flips, then goes beside, then shifts), follows its `anchor` on every render (zoom, pan, scroll); `boundary` hides it while the anchor's centre is outside an element (a map frame). `useHoverCard({ delay, closeDelay, warm })` gives one card to many triggers: `trigger(key)` returns pointer, focus and `aria-describedby` props; opens after 120 ms, at once on focus or while warm, swaps between neighbours without a flicker, lingers 90 ms, Escape dismisses, touch never opens it; `hide({ immediate })` for drags. |
| `Notice`, `EmptyState`                                                              | `Feedback.tsx`         | `Notice tone` info · warn · error · good (errors are `role="alert"`), optional `onDismiss`. Honest empty states: an emblem (`icon`), `live` to breathe while waiting, `compact` inside tables and small panels.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SortTable`, `DataTable`, `Column`                                                  | `Table.tsx`            | Sortable, selectable, sticky header and first column, dense mode; plain table. `tableCell`, `tableHead`, `tableSticky`, `tableRow`, `tableScroll` give hand-built tables (matrices, row headers) the same look; mark them `data-ui="table"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `DpsToggle`                                                                         | `DpsToggle.tsx`        | The DPS meter's `WindowSwitch` (compact label, hotkey in the title).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Ticking`, `useTick()`                                                              | `Ticking.tsx`          | Live clocks and countdowns inside a still page: `<Ticking>{(now) => …}</Ticking>` re-renders only its own children every `every` ms (default 1 s); `offset` moves the time onto another clock (`useAlerts().offsetMs`). Every `Ticking` with the same period shares one timer, which stops when the last one unmounts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Icon`, `BrandMark`                                                                 | `Icon.tsx`             | Lucide icons by name (accepts `className`); the original Wayseed brand mark (optical drawing at small sizes).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `overlayWindow()`, `OverlayCaption`, `CaptionTitle`, `CaptionState`, `WindowButton` | `Overlay.tsx`          | The chrome of every in-game window (see Overlay patterns). `overlayWindow({ glass: 'clear' \| 'deep', editing })` is the class string of a window's root sheet; `OverlayCaption` its title row (spread drag-region attributes onto it); `CaptionTitle` the accent glyph and caps name; `CaptionState` a light and a word (`tone` live · warn · muted; live breathes); `WindowButton` a ghost icon-only control whose `close` variant warms to danger on hover.                                                                                                                                                                                                                                                                                                                                        |
| `ClassIcon`, `SkillIcon`, `PetPortrait` …                                           | `GameArt.tsx`          | Verified original game art only (see `docs/GAME_ARTWORK.md`). The base look (inline, never shrinks, never draggable) is in the component; skill and class art is rounded and cropped, `SkillIcon` and `ClassIcon` take `className` for their slot. `PetPortrait` is a square frame on a flat ink tint (`bg-ink/5`, works on solid and glass alike) that fits the art whole and has no width of its own: the caller sizes and may reshape it (`w-10 rounded-full`). `PetTypeIcon` takes `className`.                                                                                                                                                                                                                                                                                                   |

Usage rules:

- **Window controls reserve room for the native state.** `WindowSwitch stacked` puts the name
  over the state in narrow grids, with the switch at the end. Toolbar controls truncate only
  the name, with its full text in the title. The state stays readable and is described to
  screen readers. Requested windows remain on while `Auto-hidden` because AION is unfocused;
  this applies to Group and Trackers as well as the meter and pet radar. Long pet and monster
  names take their own lines in the narrow radar. Preview real catalogue extremes and focus
  suppression with `?mock=long` at 1280, 1000 and 760 px, and `?mock=long&view=pet-radar` at 260 px.
- **One primary per view region.** Primary is the single most likely next action; everything else
  is secondary or ghost. Destructive actions are `danger`, and irreversible ones confirm first.
- **Buttons are for actions, chips for filters, segments for modes, tabs for places, switches for
  settings that apply at once, checkboxes for choices that are submitted or listed.**
- **Icon-only buttons** always have `aria-label` and usually a `title`.
- **Status is words first.** A badge or notice always says what it means; colour and dots support.
- **Panels do not nest more than twice.** Raised → flat (or inset). Inside a flat block, use
  hairlines (`border-line-soft`), not another box.
- **Overlay windows** use `overlayWindow()` for their root and the overlay chrome primitives,
  with the same primitives as the workspace at `size="2xs"`/`"xs"`/`"sm"`. A glass card inside
  the workspace is still `Panel variant="glass"`.
- `Card` is a region named by its own title; `Section` likewise.
- **Buttons are for actions, `Pressable` for things you open.** If the whole row or card is the
  target, it is a `Pressable` with its own hover and selected state, never a `Button` stretched
  to fit.
- **Sizes by place.** Workspace actions are `sm`; dense rows, table tools and filters `xs`;
  overlay toolbars `2xs`/`xs`; `md` is kept for a lone transport control (Replay's Play) and
  floating map tools.
- **Tooltips.** Plain hints on controls stay the native `title` attribute, which also works in
  the overlays' click-through windows. Rich facts about a mark (a spawn group, a live sighting)
  are a `HoverCard`; never give one element both, so two tooltips never appear together.

### Base UI and owned primitives

Behaviour and accessibility come from [Base UI](https://base-ui.com) (`@base-ui/react`, the
unstyled, accessible primitives by the MUI team, not Uber's `baseui` design system); the look is
ours. Each primitive in `components/ui` is a small owned file that composes Base UI parts with the
tokens above, the way shadcn/ui components are owned rather than imported:

- **What Base UI owns:** roles and ARIA state, roving focus and keyboard (tabs, segments, menus),
  dismissal (Escape, outside press) and focus return, label and description wiring in a `Field`,
  and `data-*` state attributes (`data-checked`, `data-disabled`, `data-open`,
  `data-highlighted`, `data-panel-open`). Style states with those attributes or the ARIA they set
  (`aria-pressed:`, `aria-selected:`, `aria-checked:`); a span-based control (`Checkbox`,
  `Switch`, a disabled tab) has no `:disabled`, so use `data-disabled:` there.
- **What stays ours:** tokens, shapes, sizes, `data-ui` hooks (our `data-slot`), glass, overlay
  `data-hit` and drag regions, and each primitive's public props. Base UI's `render` prop keeps
  an existing element or primitive (`render={<li />}`, `render={<Button … />}`); props on the
  rendered element win over Base UI's.
- **Kept native on purpose:** `Select` and `Textarea` (shadcn's `NativeSelect` and
  `Textarea` are native too; the OS list opens past the edge of a small in-game window), range
  sliders and file pickers (their look is the browser's own control) and the inline restore
  confirmation (a fieldset in the page, not a dialog). `HoverCard` keeps its own placement: it
  follows SVG map marks that move on zoom and pan, which a Base UI positioner does not track.
- **Portals:** a Base UI popup from an in-game window mounts inside that window's root
  (`MenuPopup container`), so it keeps the window's zoom and opacity and its `data-hit` items
  are measured as clickable regions.

**Adding a component with the shadcn CLI.** `components.json` points the CLI at the Base UI
styles (`base-vega`), the `ui` alias `@/components/ui` and the `@/` alias (`frontend/src`,
declared in `tsconfig.json` and `vite.config.ts`). Preview before writing anything:

```sh
bash dev.sh exec -- npx shadcn@latest add toggle --dry-run --view
```

Then adopt it as an owned primitive: rename the file to PascalCase and give the export our
props; import `cn` from `@/lib/cn` (the CLI writes `import { cn } from "cn"`, a package that
does not know our scales, so never add it or run `shadcn migrate cn`); replace every stock class
(`bg-primary`, `ring-ring`, `rounded-md` …) with our tokens and shapes; use `data-ui` for
`data-slot`; drop `class-variance-authority` for a plain variant map like `Button.tsx`. Never
let the CLI write theme variables or a reset into `styles/`, and never overwrite an existing
primitive (Windows paths are case-insensitive, so `button.tsx` is `Button.tsx`); `npm run check`
rejects stock colours and stray stylesheets. Add behaviour tests next to it
(`components/ui/interaction.test.tsx`).

## Workspace patterns

Reuse these rather than inventing a new frame.

- **Fewer boxes, more light.** A screen has at most one raised surface per region. Inside it,
  blocks are separated by hairlines (`border-line-soft`) and rhythm (`gap-5`), not by nested
  cards. Hierarchy comes from type (semibold titles, caps labels) and light (`shadow-glow` on
  the active thing, a tone border on a card that needs attention), not from nested frames.
- **Settings chapters** (`features/offline/SettingsLayout.tsx`): `SettingsGroup` is one raised
  surface; each `SettingsSection` puts its title and purpose on the left and controls on the
  right (stacking below 900px), with hairlines between chapters. `SettingsGrid`, `FieldGroup`
  (a labelled group that is not one input) and `RangeField` (native slider plus printed value;
  `disabled` dims it) complete it. Used by Settings, Trackers and App updates.
- **Selectable rows** (log list, preset list, pet picker): `selectableRow()` from
  `Pressable.tsx`, a quiet row that lights with `bg-row-selected` and grows a small accent stem
  on its leading edge (`before:` scaled in with `ease-grow`), instead of a bordered box.
- **Honest empty states.** Every list, table and card that can be empty says so with
  `EmptyState` (`compact` inside a card) and what will fill it, instead of a blank box.
- **Data visuals grow.** Bars, buff spans and highlight stems use `animate-grow` once. Line
  charts are monotone cubic curves (they bend but never overshoot a sample) over a flat,
  low-opacity fill of the series colour, with HTML axis labels so text never stretches with the plot
  and HTML point marks so dots stay round. Time is a rounded track (the fight overview) and
  events hang on a thread: casts as beads on a vine, buff applications as pods on a stem,
  deaths as nodes on a single line.
- **Report building blocks** (`features/offline/report/parts.tsx`): `ViewTools`,
  `ViewStack`, `SubHeading`, `Note`, `InlineSelect`, `ShareCell`.
- **Canvas drawing** reads colours and fonts from the element's computed tokens
  (`getComputedStyle(canvas).getPropertyValue('--color-…')`), never from literals.
- **Event kinds** in the timeline take nature-palette tints (`bg-sky/16 text-sky-ink` …) and
  always carry their word.
- **Things that happen in time hang on a thread.** The alerts "Next up" list is one line with
  each event a seed on it (its category glyph in a round tint), the ones close at hand lit
  with a soft ring. Field bosses hang from their map’s branch (a hairline on the left of the
  group). Alert building blocks live in `features/alerts/parts.tsx`: `AlertCard`,
  `CategoryIcon`, `Countdown`, `StateTag` (open/up breathe; unknown is dashed), `RowText`.
- **A side column is one surface in chapters.** Settings that sit beside a list (alerts
  server and clock, delivery; sightings and history) share one raised panel with titled
  chapters divided by hairlines, not a stack of small cards.
- **Living things get breathing room.** Pet portraits sit on a flat ink tint (`PetPortrait`)
  with breathing room; cards lift a pixel on hover and the art leans in very slightly (never
  altered or cropped). A complete pet wears a thin golden (`pollen`) band under its portrait;
  an unowned one is shown in grey; an unknown collection stays in full colour. Level pips are
  seeds that fill with parchment (`ink-2`) and turn golden (`pollen`) when complete; the accent
  never marks completion.
- **Pets: counts above places.** Level 3 by type (`features/pets/TypeOverview.tsx`) is one row
  of `Pressable` tiles, all pets then each type: the original type symbol, the written name,
  the count as the headline ("4 at Level 3", the figure in `text-lg`) and "of 41 pets" below.
  A chosen tile is `accent-soft` with an accent edge and filters both tabs; an unknown count
  says so in words, never zero. Six across, three below 560 px; below 980 px the symbol moves
  beside the name. The sub tabs (Map, Collection) follow, with the farming goal at their end.
  Map is the atlas: picker, map and detail side by side, never stacked over the map, so fits,
  tools and hover cards stay true; either side folds away from the map's own toolbar.
- **Maps are parchment.** Every map is light paper. A map with original art (see
  `docs/GAME_ARTWORK.md`) draws its whole canvas, its edges feathered into `bg-paper` (the
  art's own margin tone) by a ramp anchored to the canvas, so painted sea and paper run to the
  frame without a seam or a dark block. The overview draws the map until it would be scaled
  up on screen; closer in, only the native tiles meeting the view load over it, within a decode
  budget (`artLayers`). Art is never drawn closer than three screen pixels per native texture
  pixel (a fit stops at two), with no other zoom limit; Zoom in then disables. Zoom steps
  double, and the wheel zooms in proportion to its distance. Spawn points closer than a few
  screen pixels share one dot, and split apart as the view zooms in. An approximate calibration wears an "Approximate alignment" chip. A
  map without art is a chart on `bg-parchment`: a faint `paper-line` graticule (fiftieths
  once zoomed in) inside a double neatline, and a cartouche with the map's name in caps and
  "No official map art for this area". Map art is downloaded on first use: until it is
  ready the same chart is drawn on the art's own canvas (so nothing moves when it arrives),
  with a small veil pill just below the frame's centre (`MapArtNotice`: preparing,
  downloading with a meter and percentage, or failed with Retry), never a broken image. The tools float on veil glass in a rounded frame.
  Spawn points are family-coloured dots with a dark rim (`stroke-ink-inverse`), so they read
  on pale paper and painted land alike. The selection, the goal and pins are a dot inside a
  ring (ink, accent, `marker-pinned`), each ring cased in dark. Others dim only while the
  focused pet has marks on the map. Anything live sends out a slow `animate-ripple`; live
  sightings are iris diamonds and you are a dark dot in a pale rim, so shape and motion carry
  the meaning as well as colour. Map
  legends always pair a family’s swatch with its original symbol and name. Hovering or
  focusing a mark shows its `HoverCard` (`features/pets/MarkCards.tsx`: the pet with its
  portrait, family symbol, level and souls, the sources and points there, goal, pin and
  selection; a sighting with its age, distance and pets; your position), never a native
  title. The marks are one tab stop: arrow keys move to the nearest mark in view in that
  direction, Enter selects (the selected pet's own mark clears the selection), Escape
  dismisses the card, and the focused mark wears a `stroke-focus` ring on a dark rim. The in-game radar's local map has no hover cards: a
  locked radar is click-through, so the pointer never reaches it, and over the game a
  glance must not need a hover.

## Home

The workspace opens on **Home** (`features/home`), the first tab: what is going on and what
to do next, one click from every tool. It is a front page, not a grid of equal cards: a few
rich focal points with clear rhythm, each section shown only when it has real data and honest
when it has none.

- **The greeting sits on the ground,** under the contour lines, with no surface: a caps
  eyebrow (part of the day with its Lucide glyph, the date and the time), an `h2` in
  `text-3xl` naming the character in the accent when capture knows it (never guessed), and
  one line of capture state (a light and a word, then where or why). A fight under way grows
  a lit strip below it (`shadow-glow`, a breathing light, the boss's health as a `Meter`,
  time, damage, top player and the primary **Open Live**); otherwise quiet shortcuts.
- **Windows over the game** is the one raised panel of the hero: a `WindowSwitch` for every
  in-game window (DPS meter, Group, Trackers, Pet radar), the meter's lock as a pressed toggle
  and its hotkeys in `<kbd>`.
- **Ringing now** is a warm band (`border-warn-line`, a breathing bell in a `warn-soft` seed)
  that alights above everything else only while a reminder rings, answered in place with
  Snooze and Dismiss.
- **Next up** leads with the single headline figure of the page: the next opening's
  countdown in `text-3xl`, warming within five minutes and lit while open. Below it the
  **day thread**: the next three hours as one line leaving a breathing now light, hours
  marked on the server clock, every timed opening a category seed at its place (seeds that
  would overlap gather with a count). It is a picture of the list beneath it, so it is
  `aria-hidden`; the list hangs the next few on the alerts thread.
- **Last fights** are `Pressable` rows that open their report in Logs: name, result word as a
  tag (Kill, Boss reset …), age, length, players, party DPS, and the change against the
  previous fight on the same boss (a small arrow and percentage, words in the title); the
  best of the recent fights on a boss wears a `Best` tag. A line above counts
  today's fights, kills and time in combat.
- **Pet farming** is the living focal point: the goal's original portrait, its
  family symbol and name, level pips, souls to the next level and its map, then the radar one
  click away (primary **Show radar** when it is hidden), this session's pickups as figures,
  the latest pickups with their portraits and the pinned pets. With nothing chosen yet the
  first-run steps point there instead, so the empty card is left out.
- **Getting started** lists the first steps (launch the game, show the meter, finish a fight,
  turn on a reminder, choose a pet). Each ticks off from observed state only, never from a
  click on the list; the next one wears the accent ring and a primary action. While fewer
  than three steps are done it leads the side column and comes first in reading order, so
  it also leads a single column. It can be hidden (remembered locally) and disappears once
  every step is done.
- **An update waiting** in Settings is one info `Notice` at the top. On every tab the header also carries
  an accent pill (Update available, Downloading or Update ready, with the version) that opens
  Settings scrolled to App updates and focused there; it never downloads or restarts by itself.
- **Polling.** Home is mounted only while it is shown, so its own reads stop with it: pets
  status every 5 s, the radar window every 2 s, recent logs only when the library count
  changes, the pet catalogue only when there is a pet to name. While Home shows, alerts are
  read every 2 s (Alerts itself 1 s, other tabs 5 s). Update status is read every 30 s on
  every tab (5 s on Settings) for the header's update pill; only native ever checks GitHub. Countdowns and
  the clock tick through `Ticking`, so only the figures re-render.
- Columns: the main column (Next up, Last fights) and a side column (steps, Pet farming)
  from 1020 px; one column below. The hero's windows panel drops under the greeting.

## Overlay patterns

The in-game windows (the DPS meter, the top menu, group, trackers, damage details, alert popup
and pet radar) float over a live, busy, bright-or-dark 3D game, so every choice favours a
glance from a distance over decoration.

- **One sheet of glass per window.** The window root is `overlayWindow()`: rounded, a warm
  hairline edge, a faint light from above (`inset-shadow-light`) and a text halo.
  Inside it, blocks are separated by hairlines (`border-line-soft`), not by more boxes. The
  page itself stays transparent (`base.css`); never give `html`, `body` or `#root` a colour.
- **Clear glass for figures, deep glass for reading.** Windows you glance at keep the game
  visible (`glass: 'clear'`, the surface role, about 56%: the DPS meter). Windows you read sit
  on deep glass (`glass: 'deep'`, `bg-shade/80`: group, pet radar; `bg-shade/95` plus
  `data-glass="deep"` for the damage details report). Floating layers (the History menu,
  alert cards, toasts, the arrange card) are `bg-shade/90`–`/95`. The top menu bar is a
  single pebble of deep glass (`rounded-full`, `bg-shade/75`).
- **User-set see-through.** Where only the glass should thin out, mix the shade with the
  user's amount: the pet radar uses `bg-shade/(--pet-alpha)` (set inline as a percentage) so
  its text stays solid. The meter's opacity setting fades the whole window, as it always has,
  and a faded meter returns to full on hover.
- **Unlocked windows wear the accent edge.** `editing` (unlocked, movable) gives the root
  `border-accent-line` and a move cursor; a locked, click-through window rests on a quiet
  `border-line-strong`. The tracker surface rings the whole screen in the accent while
  arranging.
- **Captions are short and caps.** `OverlayCaption` + `CaptionTitle` (accent glyph, caps
  name, extras such as a count or the position age) + `CaptionState` (a light and a word:
  live breathes, warn for stale or missing data) + `WindowButton`s (close warms to danger).
  Keep native drag regions exactly where they were (`data-tauri-drag-region` on the caption
  and its title, or the pointer-travel drag from `useWindowDrag`).
- **Click-through windows mark their controls.** Everything clickable on a locked window carries
  `data-hit` (rows `data-hit="row"`), scroll viewports `data-hit-clip`; primitives take it
  through props or `segmentAttributes` / `summaryAttributes`. Never drop one when
  restyling.
- **Native geometry is a contract.** The alert popup's 6 px padding and gaps and 56 px cards
  are mirrored in `alert_window.rs`; it has no footer. The menu bar is a 32 px pill in a 512×36
  window (`MENU_WIDTH` and `MENU_HEIGHT` in `overlay.rs`). Change neither without the native side.
- **Figures align like a ledger.** Names (players, skills) are left-aligned and every figure
  is right-aligned and tabular, set per cell with explicit classes (never by `nth-child`
  position). The meter's bars grow in once from their root and the top row keeps an accent
  edge; rank numbers sit in small round seeds.
- **The pet radar is rows over a map.** A 28 px caption (map, Live / Last known / No position,
  position age), then dense two-line rows in their own scroll viewport (the goal, nearby
  monsters, then far pins), and the map below keeping at least 45% of the body, so it never
  scrolls away. A row is a 24 px portrait, the monster or pet with the nearest distance and
  arrow, then one line per pet: its type (original symbol and written name, never truncated),
  level pips, souls left in short words (the full words are the tooltip) and a 20 px pin.
  There are no totals, counts, pickup notices or help paragraphs; status is one truncated line
  with a tooltip.
- **Colour says what, shape says which kind.** On the pet radar's map (the original art on
  `bg-paper`, or a labelled `Chart` on `bg-parchment` without one; the radius a dashed
  `paper-ink` ring around a fresh position only), recorded spawn points of every pet still
  worth farming are family dots, the goal's and pins' inside an accent or `marker-pinned` ring,
  and live sightings diamonds in the colour of what they are (goal, pinned, other); the goal's
  live sighting sends out a slow ripple. You are a dark dot in a pale rim; a last known
  position is a hollow dashed rim with a `Last known` chip, and a farming map without a
  position has no player mark at all. The same marker roles colour the radar scope (shown
  only when no map is known), rows and pin buttons, and the map carries a small key.
- **A pin is always shown.** A pin is the user's own choice, so no distance, map, goal or
  max-level filter hides it: on the radar a near pin is in its monster's row (with its
  distance and direction), the goal in the goal row, and every other pin in a row of its own
  that says it is not nearby and where it spawns; the farm picker's Pinned list ignores
  Farmable here. Rows of a pinned pet wear a `marker-pinned` stem (the goal's is the accent)
  and a pin glyph before the name; a pressed pin button is a lit `marker-pinned` pebble around
  a filled pin.
- **States are data attributes.** New state hooks are `data-state`, `data-variant`,
  `data-tone`, `data-phase`, `data-category` and `data-stage`. A few unstyled class names
  remain only because tests or code query them (`meter-row`, `farm-pick-main`,
  `pet-card-main`, `is-<stage>`, `is-selected`, `is-pinned`); do not add new ones.
- **Rows that open something are `Pressable`s** (meter rows, History items) and light up the way
  the top row is lit.

## Working on a screen

1. **Run it with data.** `npm run dev`, then open `http://127.0.0.1:1420/?mock` (workspace) or
   `?view=<overlay|menu|group|trackers|details|alert-popup|pet-radar>&mock`; `?mock=fresh` shows
   a first run (nothing captured, saved, shown or chosen yet) for empty and first-run states;
   `?mock=still` keeps only a last observed position (the radar's last-known map). The dev-only mock in
   `frontend/src/dev` fakes the native runtime with realistic data; it is stripped from builds.
2. **Compose primitives.** Actions are `Button`, filters `Chip`, modes `SegmentedControl`,
   places `Tabs`, in-game windows `WindowSwitch`, whole rows and cards `Pressable`; inputs are
   `Input`/`Select`/`Checkbox`/`Switch` inside `Field`; boxes `Panel`/`Card`; states
   `Badge`/`Notice`/`EmptyState`; tables `SortTable`/`DataTable`.
3. **Style the rest with utilities and tokens only.** Layout is flex/grid utilities. Colours are
   roles (`text-ink-3`, `bg-surface-2`, `border-line`), never literals. If a needed value has no
   token, add one to `theme.css` (and to this page) rather than writing an arbitrary value. Data
   colours come from the nature palette or its aliases. Accent is always `accent`.
4. **Keep behaviour and accessibility.** Same roles, names, `aria-*` and keyboard behaviour.
   Prefer `data-*` attributes for state hooks.
5. **Verify.** Look at every state (hover, focus, selected, disabled, empty, error) at 1280 px
   and at the 760 px minimum, and overlays at their native window size over a busy background.
   Then `npm run check` and `npx vite build`.

## Guardrail

`scripts/check-design-system.mjs` runs in `npm run check` (as `npm run check:design`, right
after its own tests in `scripts/check-design-system.test.mjs`). It scans every `.ts`, `.tsx` and
`.css` file under `frontend/` except tests, and fails with `file:line:column`, the rule and a fix
hint for each problem:

| Rule               | Fails on                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `colour-literal`   | A hex, `rgb()`/`rgba()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()` or `color()` outside `frontend/src/styles/theme.css`.                |
| `arbitrary-colour` | A colour literal inside a Tailwind arbitrary value (`bg-[#123456]`, `text-[rgb(…)]`, `shadow-[0_0_8px_#fff]`), or a bare named colour (`bg-[white]`).  |
| `inline-colour`    | A colour literal or named colour in a `style={{…}}` object, or a named colour in a JSX colour attribute (`fill="red"`).                                |
| `arbitrary-radius` | A Tailwind arbitrary corner radius (`rounded-[5px]`, `rounded-tl-[2px]`, `[border-radius:4px]`) instead of a radius token; `rounded-[inherit]` passes. |
| `native-button`    | `<button>` (or `createElement('button')`, `as="button"`) outside `frontend/src/components/ui` without an opt-out marker.                               |
| `stray-stylesheet` | A stylesheet outside `frontend/src/styles`, a CSS import anywhere but `main.tsx`, or a `<style>` element.                                              |

Data-driven colours are fine as `var(--color-…)` (`style={{ background: 'var(--color-rose)' }}`,
`bg-(--color-…)`) or as values read from `lib/format.ts`; `currentColor` and `none` are not
colours.

**Allowlist.** `ALLOW` in the script lists the only files besides `theme.css` that may hold a
colour literal, each with its reason. It has one entry:

- `frontend/src/lib/format.ts`: `seriesColors`, because canvas and inline SVG marks need concrete
  values; `styles/theme.test.ts` keeps them equal to the nature palette tokens in `theme.css`.

An entry without a reason, or for a file that no longer exists, fails the check. Prefer a token
over a new entry.

**Opt-out for a native button.** If no primitive can express it, put
`design-system-allow native-button: <reason>` in a comment on the tag's line or one of the three
lines above it; a marker without a reason does not count. No file uses one.
