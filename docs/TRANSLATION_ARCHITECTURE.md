# Translation architecture

The desktop app supports English (`en`) and Brazilian Portuguese (`pt-BR`).
English remains the default and fallback. Change the language in Settings →
Interface language and save; discarding the draft keeps the current language.
The saved choice applies to the workspace and every floating window.

## Runtime decision

Use `i18next` for translation resources, interpolation, plurals and fallback, with
`react-i18next` for React subscriptions. The app has ten independently loaded
window views, extensive feature text and existing native language persistence.
These requirements justify using an established translation engine rather than
maintaining equivalent behavior in a custom dictionary helper.

Only these two translation runtime packages are needed. Bundle resources with the app;
no translation server, HTTP backend, language detector or hosted service is
needed. Selecting a language must work offline. The installed versions,
`i18next` 26.5.3 and `react-i18next` 17.1.0, declare compatibility with the
project's React 19 and TypeScript 7 through their npm peer dependencies.

Official references:

- [React integration and bundled resources](https://react.i18next.com/guides/quick-start).
- [Reactive translation hook](https://react.i18next.com/latest/usetranslation-hook).
- [Configuration, supported languages and fallback](https://www.i18next.com/overview/configuration-options).
- [Typed keys and selectors](https://www.i18next.com/overview/typescript).
- [Plural handling](https://www.i18next.com/translation-function/plurals).

The tradeoff is two dependencies and a resource maintenance workflow. They do
not write or review Portuguese translations, synchronize native windows, or
localize Rust-generated text automatically. Those remain application work.

## Integration points

- `frontend/src/types/offline.ts` defines `Locale` and `OfflineSettings.locale`.
  Stored values include `en`, `pt-BR`, legacy `pt` and seven other language codes.
- `frontend/src/features/offline/SettingsPanel.tsx` offers English and
  Português (Brasil), and preserves an unsupported saved preference explicitly.
- `frontend/src/lib/offlineNormalize.ts` supplies allowed locales and defaults.
- `crates/companion-capture/src/offline.rs` validates stored settings;
  `offline_api.rs` serializes settings transactions and persists changes.
- `src-tauri/src/offline.rs` adapts `offline_configure`, including hotkey side
  effects and rollback. `useOffline.ts` polls settings inside combat status.
- `frontend/src/main.tsx` imports the selected view before rendering.
  `app/views.ts` lists the workspace and nine floating views. Some floating
  views do not use `useOffline`; translation cannot depend on that hook.
- `frontend/src/i18n/formatters.ts` caches explicit-locale display formatters.
  Presentation uses `useFormat`; display models receive translators/formatters.
  `lib/format.ts` still owns stable series colors and legacy helper exports.
- `src-tauri/src/ui_preferences.rs` reads the saved language, refreshes native
  tray labels/window titles and broadcasts preference invalidation. Native
  clipboard summaries use `companion-capture/src/localization.rs` and the
  same embedded `native` catalogs as the tray/window adapter.

## Locale contract and compatibility

Define `UiLocale = 'en' | 'pt-BR'` independently of the broader persisted
settings type. The supported interface choices are exactly `English` and
`Português (Brasil)`. Do not advertise additional translated languages.

Resolve the stored preference as follows:

- `en` resolves to `en`.
- `pt` is a legacy alias for `pt-BR`; `pt-BR` resolves to itself.
- An absent, invalid or currently untranslated preference resolves to `en`.

Keep existing other-language values readable and valid for compatibility with
existing settings. Merely loading or saving an unrelated setting must not
replace those preferences. The selector must distinguish an unsupported stored
preference from the resolved English interface; it must not silently save `en`.
The exact presentation belongs to the UI implementation.

Native validation and frontend normalization accept `pt-BR`. New explicit
Portuguese selections write `pt-BR`. Legacy `pt` can
remain on disk until an explicit language selection; it already resolves to
Brazilian Portuguese. No recording or combat-log schema migration is necessary.

Use `en-US` for English number/date formatting and `pt-BR` for Portuguese
formatting. UI language does not change the game region, time zone, event
schedules, hotkey identifiers or protocol values. Do not infer a new preference
from the operating system; preserve the current English default.

## Resource organization and type safety

Module organization:

```text
frontend/src/i18n/
  locale.ts                 supported choices and pure locale resolution
  instance.ts               per-WebView engine creation and configuration
  resources.ts              explicit loaders by namespace and locale
  provider.tsx              React provider and presentation-only translation hook
  formatters.ts             locale-keyed Intl formatter factories
  bundled.ts                synchronous in-memory engine for tests and crash recovery
  crash.ts                  packaged English crash messages
  testing.ts                real engines over shipped catalogs for tests
  generated/resources.d.ts  generated literal English resource types
  locales/en/*.json
  locales/pt-BR/*.json
frontend/src/services/uiPreferences.ts  native reads, subscription and ordered sync
scripts/check-translations.mjs         resource validation and type generation
```

Namespaces align with features: `common`, `workspace`, `home`, `menu`, `settings`,
`live`, `reports`, `recordings`, `trackers`, `group`, `pets`, `alerts`, `timers`,
`diagnostics`, `updates` and `native`. English defines the message
schema; Portuguese implements the same messages, with its own plural categories.

Use stable semantic keys such as `settings.language.label`, never English prose
as identifiers. Use the library's typed selector API. Generate literal
declarations from English JSON so key and
interpolation inference do not rely on JSON imports preserving string literals.
Generation is deterministic and checked for stale output in CI. The generated
declaration is excluded from the formatter because its exact content is owned by
the generator; handwritten sources and catalogs remain covered by formatting.

Validate missing/extra keys, empty values, interpolation variables, and plural
families. Check required plural categories for each locale using
`Intl.PluralRules`, rather than assuming languages have identical suffixes.
Fallback is recovery for unexpected missing messages, not permission to ship
an incomplete Portuguese catalog.

Translate complete messages with named placeholders. Do not join translated
fragments or append English plural suffixes. Keep both concise overlay messages
and longer workspace descriptions where their purposes differ. Examples of
intended Portuguese copy:

- `Save settings` → `Salvar configurações`.
- `Unsaved changes to local settings.` → `Alterações não salvas nas configurações locais.`
- `No recordings yet` → `Nenhuma gravação ainda`.

Use React text interpolation for names and other untrusted values. Rich text
uses explicit React components supported by the integration; translations must
not inject HTML. Keep raw technical error detail separate from translated help.

## Startup and synchronization across windows

Native settings remain the sole durable authority. Each WebView has its own
translation instance; a JavaScript singleton cannot synchronize separate
WebViews. Do not introduce a competing localStorage language preference.

The settings-only `ui_preferences` read command returns the saved locale.
It reads existing settings without aggregating a combat report. Subscribe to a
native `ui-preferences-changed` invalidation event before the initial read.
After every successful `offline_configure` transaction, native emits this event
to all windows. Failed validation, hotkey setup or persistence emits no change.
The event carries no authoritative locale snapshot: subscribers reread the
latest committed settings, so delayed event delivery cannot revert a choice.

At bootstrap, install diagnostics and the development mock first, then register
the listener, read preferences and initialize required resource namespaces
before the first normal view render. Update `document.documentElement.lang`
and the localized document title. Use a bounded startup wait; if native settings
cannot be read, render English, record the failure and retry on reconnect or
window activation. Crash rendering must remain usable even if initialization
fails; package a minimal English crash fallback without depending on the engine.

Coalesce preference reads. If invalidation arrives during a read, discard that
read's result and perform another read before applying locale. Tear down pending
listeners on disposal, including subscriptions that finish registering late.
Refresh when a window becomes visible to recover from missed events; report
subscription failures and retry registration. Avoid per-window combat polling
solely for translation. The development mock must implement the same contract.

Keep the existing Settings draft and Save/Discard behavior: language applies
after successful Save. Discard does not switch language. Apply the committed
locale to the saving window immediately, and let the invalidation refresh other
windows. Feed both replies through the same ordered preference controller.
Guard against stale replies after a later save. Language refreshes must not
overwrite other unsaved settings or initiate another settings write.

Preload the namespaces for the selected view and its shared components in both
languages from packaged assets. Workspace-only catalogs must not force the
menu or popup to load the workspace dependency graph. A language change swaps
resources and rerenders text without remounting the feature or resetting state.

## Presentation and native boundaries

The `i18n` presentation hook may be imported by views and primitives; it must
not import native services. App composition owns the preference controller and
passes locale to the provider. Preserve the repository's existing restriction
on native/service imports in feature components.

Pure display models receive a translator or produce message descriptors
containing a typed key and parameters. Do not translate at module scope or store
translated validation messages permanently. Recompute presentation on locale
changes, including memoized tables, badges, tooltips, errors and notifications.

Replace module-scope formatters with factories cached by explicit locale and
options. Include locale in memoization dependencies. Centralize numbers,
percentages, dates, times and unit labels; audit `toLocaleString`, `toFixed`
display output and hardcoded `en-US`/`en-GB` throughout features. Preserve time
zones used for calculations and schedules. Keep `m:ss` duration notation, but
localize decimal fractions and unit-bearing text. Never parse localized display
values back into recordings, wire messages or durable numeric fields.

Keep raw game catalog names, observed player names and user-authored labels
verbatim. Translate app-authored class/type labels only where verified mappings
exist; do not invent localized game names or artwork.

For native tray labels, window titles and shortcut clipboard summaries, use a
small native presentation adapter backed by the same `native` JSON namespace,
embedded at compile time. Keep those templates to plain strings and named scalar
placeholders; test their placeholder parity and render them without HTML. Do
not reimplement the frontend plural engine in Rust. Native summary arithmetic
remains deterministic; only its human-readable labels and formatting change.
Use the saved locale even when no workspace is open. Updating a tray label must
not change its action ID or window identity.

App-authored error explanations are translated while raw native diagnostic
detail is preserved. A future migration of native failure contracts should add
stable codes and parameters, retaining readable fallback text for unknown
failures. Do not translate failures by matching English error strings. Technical
diagnostic data and native recording/log serialization stay stable.

## Adding or changing messages

1. Add semantic keys in the feature's English catalog and the corresponding
   Brazilian Portuguese messages. Translate complete sentences with named
   parameters; do not interpolate pretranslated sentence fragments.
2. For counts, add the locale's required plural forms and pass `count`. Brazilian
   Portuguese also needs `_many`; identical suffix sets are not assumed.
3. Run `npm run i18n:types`, then use the typed selector from
   `useTranslation(namespace)`. Pass a translator to pure display models;
   use `useFormat()` or `formattersFor(locale)` for display values.
4. Add a new namespace to `resources.ts` and the views that need it when creating
   a feature. Native-only plain strings belong to `native.json`; the native
   adapter supports named scalar placeholders, without rich text or plurals.
5. Follow `AGENTS.md` for UI changes, then check both languages at the workspace's
   760 px minimum and compact windows' native sizes. Keep actions reachable,
   accessibility labels translated, and drag/hit regions intact.

## Verification

`npm run check:i18n` tests the catalog guardrail, validates every catalog and
checks generated declarations. `npm run check` includes it alongside the full
frontend checks. `npm run build` also validates catalogs before producing the
packaged frontend.

Regression tests cover locale aliases, required keys/placeholders/plurals,
explicit-locale formatting, real React translation subscriptions, settings
Save/Discard/failure, startup fallback, multiple-window invalidation ordering and
subscription cleanup. Representative Portuguese feature tests use the actual
catalogs. Native tests verify locale compatibility, preserved player/game text,
summary formatting and unchanged combat report data.

Browser previews support `?mock&locale=pt-BR` and
`?view=pet-radar&mock&locale=pt-BR`; omit `locale` for English. The development mock
implements the preference read and invalidation contract. Browser tabs have
independent mock state; service tests exercise shared native state across windows.
For empty-state checks, use `?mock=fresh&locale=pt-BR`. Mock code is excluded from
production builds. Verify native tray/shortcut behavior in the desktop app when
changing those adapters.
