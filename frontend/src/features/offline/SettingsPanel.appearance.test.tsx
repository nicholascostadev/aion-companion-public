import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationProvider } from '../../i18n/provider';
import { createTestI18n } from '../../i18n/testing';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { OfflineSettings } from '../../types/offline';
import { useSettingsDraft } from './settingsModel';
import { SaveBar, SettingsPanel } from './SettingsPanel';

const ADMIN_NOTE =
  'Works only when Aion Companion is started as administrator, because AION 2 runs as administrator.';

/** The Appearance settings with a real translation engine; a save keeps what was sent. */
function setup(elevated: boolean | undefined) {
  let native: OfflineSettings = SETTINGS_FALLBACK;
  const save = vi.fn<(next: OfflineSettings) => Promise<boolean>>(async (next) => {
    native = next;
    return true;
  });
  render(
    <TranslationProvider i18n={createTestI18n('en')}>
      <Panel settings={native} save={save} elevated={elevated} />
    </TranslationProvider>,
  );
  return { save, saved: () => native };
}

function Panel({
  settings,
  save,
  elevated,
}: {
  settings: OfflineSettings;
  save: (s: OfflineSettings) => Promise<boolean>;
  elevated: boolean | undefined;
}) {
  const draft = useSettingsDraft(settings, save);
  return (
    <>
      <SettingsPanel
        category="appearance"
        status={null}
        draft={draft}
        native
        busy={false}
        onAction={async () => true}
        catalogueImport={{ result: null, load: async () => {}, dismiss: () => {} }}
        onCopySummary={async () => {}}
        elevated={elevated}
      />
      <SaveBar draft={draft} error="" />
    </>
  );
}

const hideWithEsc = () => screen.getByRole('switch', { name: /Hide with Esc/ });

afterEach(cleanup);

describe('Hide with Esc', () => {
  it('is on by default and saves when turned off', async () => {
    const { save, saved } = setup(true);
    expect(hideWithEsc().getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByText(
        'In game, Esc hides the meter and its damage details, and Esc again shows them.',
      ),
    ).toBeTruthy();
    fireEvent.click(hideWithEsc());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    });
    expect(save).toHaveBeenCalledOnce();
    expect(saved()).toEqual({ ...SETTINGS_FALLBACK, hide_on_escape: false });
  });

  it('says it needs administrator only when native reports the companion is not elevated', () => {
    setup(false);
    expect(screen.getByText(ADMIN_NOTE)).toBeTruthy();
    cleanup();
    setup(true);
    expect(screen.queryByText(ADMIN_NOTE)).toBeNull();
    cleanup();
    // Unknown (browser preview, an older native): nothing is claimed.
    setup(undefined);
    expect(screen.queryByText(ADMIN_NOTE)).toBeNull();
  });
});
