import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCrashI18n } from './crash';
import { applyLocale, createI18n } from './instance';
import { TranslationProvider, useFormat, useLocale, useTranslation } from './provider';

afterEach(cleanup);

function Probe() {
  const { t } = useTranslation('timers');
  const fmt = useFormat();
  const locale = useLocale();
  const [clicks, setClicks] = useState(0);
  return (
    <button type="button" onClick={() => setClicks(clicks + 1)}>
      {t(($) => $.daily)} · {fmt.number.format(1234.5)} · {locale} · {clicks}
    </button>
  );
}

describe('translation provider', () => {
  it('loads catalogs on demand and rewords in place when the language changes', async () => {
    // `timers` is not preloaded here: the packaged catalog is read on first use.
    const i18n = await createI18n({ namespaces: ['common'] });
    render(
      <TranslationProvider i18n={i18n}>
        <Probe />
      </TranslationProvider>,
    );
    const button = await screen.findByRole('button', { name: 'Daily reset · 1,234.5 · en · 0' });
    act(() => button.click());
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('Aion Companion');

    await act(async () => applyLocale(i18n, 'pt-BR'));
    // Same element, state kept: nothing was remounted.
    expect(button.textContent).toBe('Reset diário · 1.234,5 · pt-BR · 1');
    expect(document.documentElement.lang).toBe('pt-BR');
  });

  it('reports a message missing from a catalog instead of failing', async () => {
    const onMissing = vi.fn<(locale: string, ns: string, key: string) => void>();
    const i18n = await createI18n({ namespaces: ['common'], onMissing });
    // An unknown key cannot be written with the typed selector; look it up untyped.
    const lookUp = i18n.t as unknown as (key: string, options: { ns: string }) => string;
    expect(lookUp('no.such.key', { ns: 'common' })).toBe('no.such.key');
    expect(onMissing).toHaveBeenCalledWith('en', 'common', 'no.such.key');
  });

  it('has a packaged English crash engine that needs no loading', () => {
    const i18n = createCrashI18n();
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.getFixedT('en', 'diagnostics')(($) => $.crash.title)).toBe(
      'This window stopped on an error',
    );
  });
});
