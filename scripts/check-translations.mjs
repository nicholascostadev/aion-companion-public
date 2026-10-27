/*
 * Translation catalog guardrail, run by `npm run check` (see docs/TRANSLATION_ARCHITECTURE.md).
 *
 *   node scripts/check-translations.mjs           validate, and fail if the generated types are stale
 *   node scripts/check-translations.mjs --write   validate and regenerate the types
 *
 * English (frontend/src/i18n/locales/en) defines every message; each other locale must
 * implement exactly the same messages. Checked per message: the key exists in every locale,
 * the value is a non-empty string, the same {{placeholders}} and <0>component</0> tags are
 * used, plural families carry exactly the categories `Intl.PluralRules` requires for that
 * locale (`_zero` is optional), and no message contains HTML or nested `$t()` calls.
 *
 * The generated declaration (frontend/src/i18n/generated/resources.d.ts) gives i18next the
 * English messages as string literals, so keys and placeholders are type-checked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export const LOCALES_DIR = 'frontend/src/i18n/locales';
export const GENERATED = 'frontend/src/i18n/generated/resources.d.ts';
export const SOURCE_LOCALE = 'en';
export const LOCALES = ['en', 'pt-BR'];
/** Read by the native shell, not by any window: validated, but not part of the window types. */
export const NATIVE_NAMESPACE = 'native';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{\s*([^,}\s]+)\s*(?:,[^}]*)?\}\}/g;
const COMPONENT = /<\/?(\d+)\s*\/?>/g;
const MARKUP = /<\/?[a-zA-Z][^>]*>/;

/** Flattens nested messages into dotted keys; non-string leaves are reported. */
export function flatten(value, prefix = '', out = new Map(), problems = []) {
  for (const [key, child] of Object.entries(value)) {
    const at = prefix ? `${prefix}.${key}` : key;
    if (key.includes('.')) problems.push(`${at}: keys must not contain "."`);
    if (child !== null && typeof child === 'object' && !Array.isArray(child))
      flatten(child, at, out, problems);
    else if (typeof child === 'string') out.set(at, child);
    else problems.push(`${at}: messages must be strings`);
  }
  return { messages: out, problems };
}

const sorted = (values) => [...new Set(values)].sort();
const placeholders = (text) => sorted([...text.matchAll(PLACEHOLDER)].map((m) => m[1]));
const components = (text) => sorted([...text.matchAll(COMPONENT)].map((m) => m[1]));

/** Groups `key_one`/`key_other` under `key`; other keys are their own family. */
export function families(messages) {
  const out = new Map();
  for (const [key, text] of messages) {
    const match = PLURAL_SUFFIX.exec(key);
    const base = match ? key.slice(0, match.index) : key;
    let family = out.get(base);
    if (!family) out.set(base, (family = { plural: false, forms: new Map() }));
    if (match) family.plural = true;
    family.forms.set(match ? match[1] : '', text);
  }
  return out;
}

export const requiredCategories = (locale) =>
  sorted(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);

/** Problems in one namespace's catalogs, keyed by locale → flattened messages. */
export function validateNamespace(ns, catalogs) {
  const problems = [];
  const source = catalogs.get(SOURCE_LOCALE);
  if (!source) return [`${ns}: missing ${SOURCE_LOCALE} catalog`];
  const sourceFamilies = families(source);
  for (const [locale, messages] of catalogs) {
    const where = `${locale}/${ns}`;
    const mine = families(messages);
    const required = requiredCategories(locale);
    for (const [key, text] of messages) {
      if (!text.trim()) problems.push(`${where}: "${key}" is empty`);
      if (MARKUP.test(text.replace(COMPONENT, '')))
        problems.push(`${where}: "${key}" contains markup; use numbered components (<0>…</0>)`);
      if (text.includes('$t(')) problems.push(`${where}: "${key}" nests $t(); compose in code`);
    }
    for (const [base, family] of mine) {
      if (!family.plural) continue;
      if (family.forms.has(''))
        problems.push(`${where}: "${base}" is both a plain message and a plural family`);
      const categories = sorted([...family.forms.keys()].filter((c) => c && c !== 'zero'));
      if (categories.join() !== required.join())
        problems.push(
          `${where}: plural "${base}" has [${categories}] but ${locale} needs [${required}]`,
        );
    }
    if (locale === SOURCE_LOCALE) continue;
    for (const base of sourceFamilies.keys())
      if (!mine.has(base)) problems.push(`${where}: missing "${base}"`);
    for (const [base, family] of mine) {
      const english = sourceFamilies.get(base);
      if (!english) {
        problems.push(`${where}: "${base}" is not an English message`);
        continue;
      }
      if (english.plural !== family.plural)
        problems.push(`${where}: "${base}" must ${english.plural ? '' : 'not '}be a plural family`);
      const all = (f, read) => sorted([...f.forms.values()].flatMap(read));
      // Plural forms may leave {{count}} out ("one recording"); every other name must match.
      const names = (f) => all(f, placeholders).filter((n) => !(f.plural && n === 'count'));
      if (names(english).join() !== names(family).join())
        problems.push(
          `${where}: "${base}" uses {{${names(family)}}} but English uses {{${names(english)}}}`,
        );
      if (all(english, components).join() !== all(family, components).join())
        problems.push(`${where}: "${base}" components differ from English`);
    }
  }
  return problems;
}

/** Every locale → namespace → parsed catalog under `dir`. */
export function readCatalogs(dir = path.join(root, LOCALES_DIR)) {
  const out = new Map();
  const problems = [];
  for (const locale of fs.readdirSync(dir).sort()) {
    if (!LOCALES.includes(locale)) {
      problems.push(`${locale}: not a supported interface locale`);
      continue;
    }
    const namespaces = new Map();
    for (const file of fs.readdirSync(path.join(dir, locale)).sort()) {
      if (!file.endsWith('.json')) continue;
      try {
        namespaces.set(
          file.slice(0, -5),
          JSON.parse(fs.readFileSync(path.join(dir, locale, file), 'utf8')),
        );
      } catch (cause) {
        problems.push(`${locale}/${file}: ${cause.message}`);
      }
    }
    out.set(locale, namespaces);
  }
  for (const locale of LOCALES) if (!out.has(locale)) problems.push(`${locale}: no catalogs`);
  return { catalogs: out, problems };
}

export function validate(catalogs) {
  const problems = [];
  const names = sorted([...catalogs.values()].flatMap((nss) => [...nss.keys()]));
  for (const ns of names) {
    const byLocale = new Map();
    for (const [locale, nss] of catalogs) {
      const raw = nss.get(ns);
      if (raw === undefined) {
        problems.push(`${locale}: missing namespace "${ns}"`);
        continue;
      }
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        problems.push(`${locale}/${ns}: a catalog is a JSON object`);
        continue;
      }
      const flat = flatten(raw);
      problems.push(...flat.problems.map((p) => `${locale}/${ns}: ${p}`));
      // A namespace exists for text a window shows; an empty one is an unfinished extraction.
      if (flat.messages.size === 0) problems.push(`${locale}/${ns}: catalog has no messages`);
      byLocale.set(locale, flat.messages);
    }
    problems.push(...validateNamespace(ns, byLocale));
  }
  return problems;
}

const quote = (text) => JSON.stringify(text);
const identifier = (key) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key));

function declare(value, depth) {
  const pad = '  '.repeat(depth);
  if (Object.keys(value).length === 0) return '{}';
  const lines = Object.keys(value)
    .sort()
    .map((key) => {
      const child = value[key];
      const type = typeof child === 'string' ? quote(child) : declare(child, depth + 1);
      return `${pad}  readonly ${identifier(key)}: ${type};`;
    });
  return `{\n${lines.join('\n')}\n${pad}}`;
}

/** The declaration file for the English window catalogs: deterministic for the same input. */
export function generateTypes(catalogs) {
  const english = catalogs.get(SOURCE_LOCALE) ?? new Map();
  const namespaces = [...english.keys()].filter((ns) => ns !== NATIVE_NAMESPACE).sort();
  const body = namespaces
    .map((ns) => `      readonly ${identifier(ns)}: ${declare(english.get(ns), 3)};`)
    .join('\n');
  return `// Generated by scripts/check-translations.mjs from locales/${SOURCE_LOCALE}; do not edit.
// Run \`npm run i18n:types\` after changing an English message.
import 'i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    enableSelector: true;
    returnNull: false;
    resources: {
${body}
    };
  }
}
`;
}

function main() {
  const write = process.argv.includes('--write');
  const { catalogs, problems } = readCatalogs();
  const generated = generateTypes(catalogs);
  const target = path.join(root, GENERATED);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  const englishReadable = !problems.some((p) => p.startsWith(`${SOURCE_LOCALE}/`));
  // Types come from English alone, so they are written even while a translation is incomplete.
  if (write && englishReadable && current !== generated) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, generated);
    console.log(`Wrote ${GENERATED}.`);
  } else if (!write && current !== generated)
    problems.push(`${GENERATED} is stale. Run \`npm run i18n:types\`.`);
  problems.push(...validate(catalogs));
  if (problems.length) {
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`\nTranslation check: ${problems.length} problem(s).`);
    process.exit(1);
  }
  const counts = [...catalogs].map(
    ([locale, nss]) =>
      `${locale} ${[...nss.values()].reduce((n, c) => n + flatten(c).messages.size, 0)}`,
  );
  console.log(`Translation check passed: ${counts.join(', ')} messages.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
