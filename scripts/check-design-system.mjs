/*
 * Design-system guardrail, run by `npm run check`. Fails on styling that bypasses the
 * tokens and primitives (see docs/DESIGN_SYSTEM.md, "Guardrail"):
 *
 *   colour-literal      hex, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch(), color()
 *                       outside frontend/src/styles/theme.css
 *   arbitrary-colour    a colour literal inside a Tailwind arbitrary value (bg-[#…], [color:…])
 *   inline-colour       a colour literal or named colour in a style={{…}} object or a JSX colour
 *                       attribute (fill="red")
 *   arbitrary-radius    a Tailwind arbitrary corner radius (rounded-[5px], [border-radius:…])
 *                       instead of a radius token; rounded-[inherit] is allowed
 *   native-button       <button> outside frontend/src/components/ui without an opt-out marker
 *   stray-stylesheet    a stylesheet outside frontend/src/styles, a CSS import other than the
 *                       one in main.tsx, or a <style> element
 *
 * Test files are not scanned: they render fixtures and assert on literal values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export const THEME = 'frontend/src/styles/theme.css';
export const STYLES = 'frontend/src/styles/';
export const PRIMITIVES = 'frontend/src/components/ui/';
export const ENTRY = 'frontend/src/main.tsx';

/*
 * The only files allowed to hold a colour literal besides theme.css. Every entry says why;
 * keep the list short and add a token to theme.css instead whenever that is possible.
 */
export const ALLOW = [
  {
    file: 'frontend/src/lib/format.ts',
    rule: 'colour-literal',
    reason:
      'seriesColors: canvas and inline SVG marks need concrete values; styles/theme.test.ts keeps them equal to the nature palette tokens in theme.css.',
  },
];

/*
 * Opt-out for a native <button> outside components/ui. The marker goes on the line of the
 * tag or on one of the three lines above it, and must give a reason after the colon:
 *   {/* design-system-allow native-button: why no primitive fits *\/}
 */
export const BUTTON_MARKER = /design-system-allow native-button:\s*[a-z]/i;

export const HINTS = {
  'colour-literal':
    'Use a colour role (text-ink-2, bg-surface, border-line …) or a palette token; if none fits, add a token to styles/theme.css first.',
  'arbitrary-colour':
    'Arbitrary colour values bypass the tokens. Use the role utility (bg-accent-soft) or a var(): bg-(--color-…).',
  'inline-colour':
    'Inline colours bypass the scheme. Use a utility class, or pass var(--color-…) when the colour is data-driven.',
  'arbitrary-radius':
    'Use a radius token (rounded-xs … rounded-2xl, rounded-full). A nested corner is the outer radius minus the gap, rounded to the nearest token; rounded-[inherit] follows the parent.',
  'native-button':
    'Use Button (actions), Chip, SegmentedControl, Tabs, WindowSwitch, or Pressable for a whole row or card. If none fits, add a marker: design-system-allow native-button: <reason>.',
  'stray-stylesheet':
    'All CSS lives in frontend/src/styles and enters through styles/index.css, imported once by main.tsx. Style with utilities instead.',
};

// `_` may precede a hex inside an arbitrary value (shadow-[0_0_8px_#fff]); letters, digits,
// `&` (entities) and `#` rule it out.
const HEX = /(?<![A-Za-z0-9&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const COLOUR_FN =
  /(?<![A-Za-z0-9-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|(?<![A-Za-z0-9-])color\((?=\s*(?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz))/g;
const NAMED_COLOURS = new Set(
  (
    'aqua black blue brown crimson cyan fuchsia gold gray green grey indigo ivory lime magenta ' +
    'maroon navy olive orange orchid pink plum purple red salmon silver tan teal tomato turquoise ' +
    'violet wheat white yellow'
  ).split(' '),
);
const COLOUR_PROPS =
  /\b(color|background|backgroundColor|backgroundImage|border(?:Top|Right|Bottom|Left)?(?:Color)?|outline(?:Color)?|fill|stroke|boxShadow|textShadow|caretColor|accentColor|textDecorationColor|stopColor|floodColor)\s*:\s*(['"`])([^'"`]*)\2/g;
// rounded-[5px], before:rounded-tl-[2px], [border-radius:4px]; rounded-[inherit] follows a parent.
const ARBITRARY_RADIUS =
  /(?<![\w-])rounded(?:-(?:[trblse]|tl|tr|br|bl|ss|se|es|ee))?-\[(?!inherit\])[^\]\s]+\]|\[border-(?:[a-z]+-)*radius:[^\]\s]+\]/g;
const COLOUR_ATTRS = /\b(fill|stroke|color|stopColor|floodColor|lightingColor)=(['"])([^'"]*)\2/g;

/** Every colour literal on a line, as [start, end, text]. */
function colourLiterals(line) {
  const found = [];
  for (const pattern of [HEX, COLOUR_FN]) {
    pattern.lastIndex = 0;
    for (const m of line.matchAll(pattern)) found.push([m.index, m.index + m[0].length, m[0]]);
  }
  return found.sort((a, b) => a[0] - b[0]);
}

const hasNamedColour = (value) =>
  value
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => NAMED_COLOURS.has(word));

/** Spans of `style={{ … }}` objects in a TSX source, by balanced braces. */
function styleSpans(text) {
  const spans = [];
  for (const m of text.matchAll(/style=\{\{/g)) {
    let depth = 2;
    let i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
    }
    spans.push([m.index, i]);
  }
  return spans;
}

const allowed = (file, rule) => ALLOW.some((a) => a.file === file && a.rule === rule);

/**
 * Problems in one source file. `file` is the repo-relative path with forward slashes;
 * `text` its contents. Returns [{ file, line, column, rule, match }].
 */
export function scan(file, text) {
  const problems = [];
  const report = (line, column, rule, match) =>
    problems.push({ file, line: line + 1, column: column + 1, rule, match });
  const isCss = /\.(?:css|scss|sass|less)$/.test(file);
  const isTsx = file.endsWith('.tsx');
  if (!/\.(?:css|ts|tsx)$/.test(file) && !isCss) return problems;

  if (isCss && !file.startsWith(STYLES)) report(0, 0, 'stray-stylesheet', path.basename(file));

  const lines = text.split(/\r?\n/);
  const lineStarts = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const styles = isTsx ? styleSpans(text.replace(/\r\n/g, '\n')) : [];
  const inStyle = (line, column) => {
    const index = lineStarts[line] + column;
    return styles.some(([a, b]) => index >= a && index < b);
  };

  lines.forEach((line, n) => {
    // Colour literals, unless this is the theme or an allowlisted file.
    if (file !== THEME && !allowed(file, 'colour-literal')) {
      const arbitrary = [];
      if (!isCss) {
        for (const m of line.matchAll(/\[[^\]\s'"`]*\]/g)) {
          // A literal anywhere inside, or a bare named colour as the whole value (bg-[white]).
          const named = /^\[(?:color:)?([a-z]+)\]$/.exec(m[0]);
          if (colourLiterals(m[0]).length || (named && NAMED_COLOURS.has(named[1]))) {
            arbitrary.push([m.index, m.index + m[0].length]);
            report(n, m.index, 'arbitrary-colour', m[0]);
          }
        }
      }
      for (const [start, , literal] of colourLiterals(line)) {
        if (arbitrary.some(([a, b]) => start >= a && start < b)) continue;
        report(n, start, isTsx && inStyle(n, start) ? 'inline-colour' : 'colour-literal', literal);
      }
    }
    if (isTsx) {
      // Named colours in style objects and colour attributes (literals are reported above).
      for (const m of line.matchAll(COLOUR_PROPS)) {
        if (inStyle(n, m.index) && hasNamedColour(m[3]) && !colourLiterals(m[3]).length)
          report(n, m.index, 'inline-colour', m[0]);
      }
      for (const m of line.matchAll(COLOUR_ATTRS)) {
        if (hasNamedColour(m[3]) && !colourLiterals(m[3]).length)
          report(n, m.index, 'inline-colour', m[0]);
      }
      // Corner radii off the token scale.
      for (const m of line.matchAll(ARBITRARY_RADIUS)) report(n, m.index, 'arbitrary-radius', m[0]);
      // Native buttons outside the primitives.
      if (!file.startsWith(PRIMITIVES)) {
        for (const m of line.matchAll(
          /<button\b|createElement\(\s*['"]button['"]|\bas=(?:["']button["']|\{\s*['"]button['"]\s*\})/g,
        )) {
          const context = lines.slice(Math.max(0, n - 3), n + 1).join('\n');
          if (!BUTTON_MARKER.test(context)) report(n, m.index, 'native-button', m[0]);
        }
      }
      for (const m of line.matchAll(/<style\b/g)) report(n, m.index, 'stray-stylesheet', m[0]);
    }
    if (!isCss && file !== ENTRY) {
      for (const m of line.matchAll(
        /\bimport\s*(?:[^'"]*?\bfrom\s*)?['"][^'"]+\.(?:css|scss|sass|less)(?:\?[^'"]*)?['"]/g,
      ))
        report(n, m.index, 'stray-stylesheet', m[0]);
    }
  });
  return problems;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

/** Every scanned file under `dir` (repo-relative, forward slashes). */
export function walk(dir, base = root) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(base, dir), { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel, base));
    else if (
      /\.(?:css|scss|sass|less|ts|tsx)$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    )
      out.push(rel);
  }
  return out;
}

export function format(problems) {
  const lines = [`Design-system check failed: ${problems.length} problem(s).`, ''];
  for (const p of problems) {
    lines.push(`${p.file}:${p.line}:${p.column}  ${p.rule}  ${p.match}`);
    lines.push(`  ${HINTS[p.rule]}`);
  }
  lines.push('', 'Rules, allowlist and opt-out: docs/DESIGN_SYSTEM.md, "Guardrail".');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const files = walk('frontend');
  const problems = files.flatMap((file) =>
    scan(file, fs.readFileSync(path.join(root, file), 'utf8')),
  );
  for (const entry of ALLOW) {
    if (!fs.existsSync(path.join(root, entry.file)) || !entry.reason) {
      console.error(`Design-system allowlist entry is stale or has no reason: ${entry.file}`);
      process.exit(1);
    }
  }
  if (problems.length) {
    console.error(format(problems));
    process.exit(1);
  }
  console.log(
    `Design system: ${files.length} files clean (no stray colours, radii, native buttons or stylesheets).`,
  );
}
