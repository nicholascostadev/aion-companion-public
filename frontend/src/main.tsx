import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { i18n as I18n } from 'i18next';
import { isTauri } from '@tauri-apps/api/core';
import { resolveView, surfaceOf, VIEWS } from './app/views';
import { MapArtProvider } from './features/maps/mapArt';
import { nativeMapArt } from './hooks/mapArtStore';
import { CrashApp } from './app/CrashApp';
import { createCrashI18n } from './i18n/crash';
import { applyLocale, createI18n } from './i18n/instance';
import { resolveUiLocale } from './i18n/locale';
import { TranslationProvider } from './i18n/provider';
import { VIEW_NAMESPACES } from './i18n/resources';
import { describeCause, installDiagnostics, recordDiagnostic } from './services/diagnostics';
import { installOverlayKeyboard } from './services/overlayKeyboard';
import {
  createPreferenceSync,
  onUiPreferencesChanged,
  readUiPreferences,
  setActivePreferenceSync,
} from './services/uiPreferences';
import './styles/index.css';

/** Longest a window waits for its saved language before showing English. */
const LANGUAGE_WAIT_MS = 1500;

// No window shows the browser's context menu, even before rendering or after a crash. Captured
// first so a handler that stops propagation cannot bring it back; app handlers still receive it.
window.addEventListener('contextmenu', (event) => event.preventDefault(), true);

// Dev-only visual testing (`?mock`): fake native data in a plain browser. Removed from builds.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('mock'))
  await import('./dev/mockNative').then((m) => m.install());

// Before anything renders, so startup errors and failed native commands are kept for a bug report.
installDiagnostics();

const root = document.getElementById('root');
if (!root) throw new Error('Missing React root element');
const view = resolveView(window.location.search);
document.documentElement.dataset.surface = surfaceOf(view);
// In-game windows never take focus from the game; only pressing a text field asks for the keyboard.
if (view !== 'workspace') installOverlayKeyboard();

let crashed = false;
let i18n: I18n | null = null;
const reactRoot = createRoot(root, {
  onUncaughtError(error, info) {
    recordDiagnostic('error', 'react', error);
    console.error(error, info.componentStack);
    // The workspace is where bug reports are made; it never stays blank after a crash.
    if (view === 'workspace') showCrash(error);
  },
  onCaughtError(error, info) {
    recordDiagnostic('error', 'react', error);
    console.error(error, info.componentStack);
  },
  onRecoverableError(error) {
    recordDiagnostic('warn', 'react', error);
    console.warn(error);
  },
});

function showCrash(cause: unknown) {
  if (crashed) return;
  crashed = true;
  // After React has finished unmounting the failed tree.
  setTimeout(() => {
    // The packaged English messages stand in when the translation engine itself failed.
    const engine = i18n ?? createCrashI18n();
    reactRoot.render(
      <TranslationProvider i18n={engine}>
        <CrashApp native={isTauri()} detail={describeCause(cause)} />
      </TranslationProvider>,
    );
  });
}

const translation = createI18n({
  namespaces: VIEW_NAMESPACES[view],
  onMissing: (locale, ns, key) =>
    recordDiagnostic('warn', 'i18n', `Missing message ${ns}:${key} (${locale})`),
});

// The saved language, read once before the first render and followed from then on. Native
// settings are its only home; a window that cannot read them shows English and retries.
let language: Promise<void> = Promise.resolve();
if (isTauri()) {
  const sync = createPreferenceSync({
    read: readUiPreferences,
    subscribe: onUiPreferencesChanged,
    apply: async (stored) => applyLocale(await translation, resolveUiLocale(stored)),
    report: (source, cause) => recordDiagnostic('warn', source, cause),
  });
  setActivePreferenceSync(sync);
  language = sync.start(LANGUAGE_WAIT_MS);
}

// Loaded before the first render, so a window never shows a placeholder frame.
let View: ComponentType | null = null;
try {
  // The first frame is already in the saved language when native answers in time.
  [i18n, View] = await Promise.all([
    translation,
    VIEWS[view]().then((module) => module.default),
    language,
  ]);
} catch (cause) {
  recordDiagnostic('error', 'startup', cause);
  if (view !== 'workspace') throw cause;
  showCrash(cause);
}
if (View && i18n)
  reactRoot.render(
    <TranslationProvider i18n={i18n}>
      {isTauri() ? (
        // Map art is downloaded per map on first use; without the app it is always drawn.
        <MapArtProvider value={nativeMapArt}>
          <View />
        </MapArtProvider>
      ) : (
        <View />
      )}
    </TranslationProvider>,
  );
