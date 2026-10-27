import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { i18n as I18n } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveUiLocale } from '../../i18n/locale';
import { TranslationProvider } from '../../i18n/provider';
import { createTestI18n } from '../../i18n/testing';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { Locale, OfflineSettings } from '../../types/offline';
import { useSettingsDraft } from './settingsModel';
import { SaveBar, SettingsPanel } from './SettingsPanel';

/**
 * The workspace's Settings with a real translation engine. A successful save does what the
 * app does: native keeps the settings and this window shows their language.
 */
function setup(locale: Locale, { fails = false } = {}) {
  const i18n = createTestI18n('en');
  let native: OfflineSettings = { ...SETTINGS_FALLBACK, locale };
  const save = vi.fn<(next: OfflineSettings) => Promise<boolean>>(async (next) => {
    if (fails) return false;
    native = next;
    view.rerender(<Harness i18n={i18n} settings={native} save={save} />);
    await i18n.changeLanguage(resolveUiLocale(next.locale));
    return true;
  });
  const view = render(<Harness i18n={i18n} settings={native} save={save} />);
  return { i18n, save, saved: () => native };
}

function Harness({
  i18n,
  settings,
  save,
}: {
  i18n: I18n;
  settings: OfflineSettings;
  save: (s: OfflineSettings) => Promise<boolean>;
}) {
  return (
    <TranslationProvider i18n={i18n}>
      <Panel settings={settings} save={save} />
    </TranslationProvider>
  );
}

function Panel({
  settings,
  save,
}: {
  settings: OfflineSettings;
  save: (s: OfflineSettings) => Promise<boolean>;
}) {
  const draft = useSettingsDraft(settings, save);
  return (
    <>
      <SettingsPanel
        status={null}
        draft={draft}
        native
        busy={false}
        onAction={async () => true}
        onImportCatalogue={async () => ({ skills: 0, npcs: 0 })}
        onCopySummary={async () => {}}
      />
      <SaveBar draft={draft} error="" />
    </>
  );
}

const language = () =>
  screen.getByRole('combobox', { name: /Interface language|Idioma da interface/ });
const choose = (value: string) => fireEvent.change(language(), { target: { value } });

afterEach(cleanup);

describe('Settings language', () => {
  it('lists English and Portuguese (Brazil) and switches only after a successful save', async () => {
    const { i18n, save, saved } = setup('en');
    const options = [...(language() as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(['English', 'Português (Brasil)']);

    choose('pt-BR');
    expect(i18n.language).toBe('en');
    expect(screen.getByText('Unsaved changes to local settings.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    });
    expect(save).toHaveBeenCalledOnce();
    expect(saved().locale).toBe('pt-BR');
    expect(i18n.language).toBe('pt-BR');
    expect(screen.getByRole('heading', { name: 'Medidor e lutas' })).toBeTruthy();
    expect(screen.getByText(/^Salvo às /)).toBeTruthy();
  });

  it('keeps the language when the choice is discarded', () => {
    const { i18n, save } = setup('en');
    choose('pt-BR');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(save).not.toHaveBeenCalled();
    expect(i18n.language).toBe('en');
    expect((language() as HTMLSelectElement).value).toBe('en');
    expect(screen.queryByText('Unsaved changes to local settings.')).toBeNull();
  });

  it('keeps the language when native refuses the save', async () => {
    const { i18n } = setup('en', { fails: true });
    choose('pt-BR');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    });
    expect(i18n.language).toBe('en');
    expect(screen.getByText('Unsaved changes to local settings.')).toBeTruthy();
  });

  it('rewords in place when another window changes the language, keeping unsaved edits', async () => {
    const { i18n } = setup('en');
    fireEvent.click(screen.getByRole('switch', { name: /Auto-save every finished fight/ }));
    expect(screen.getByText('Unsaved changes to local settings.')).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage('pt-BR');
    });
    expect(screen.getByText('Alterações não salvas nas configurações locais.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar configurações' })).toBeTruthy();
    expect(
      (screen.getByRole('switch', { name: /Salvar automaticamente/ }) as HTMLButtonElement)
        .ariaChecked,
    ).toBe('false');
  });

  it('shows the legacy pt value as Portuguese (Brazil) and keeps it on an unrelated save', async () => {
    const { saved } = setup('pt');
    expect((language() as HTMLSelectElement).value).toBe('pt-BR');
    fireEvent.click(screen.getByRole('switch', { name: /Hide character names|Ocultar nomes/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save settings|Salvar configurações/ }));
    });
    expect(saved().locale).toBe('pt');
    expect(saved().hide_names).toBe(true);
  });

  it('keeps an untranslated saved language instead of silently saving English', async () => {
    const { i18n, saved } = setup('de');
    const select = language() as HTMLSelectElement;
    expect(select.value).toBe('de');
    expect(select.selectedOptions[0]?.textContent).toBe(
      'Deutsch (saved; not translated, English is shown)',
    );
    fireEvent.click(screen.getByRole('switch', { name: /Hide character names/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    });
    expect(saved().locale).toBe('de');
    expect(i18n.language).toBe('en');
  });
});
