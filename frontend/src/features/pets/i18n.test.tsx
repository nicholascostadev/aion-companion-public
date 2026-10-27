import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getI18n, setI18n } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formattersFor } from '../../i18n/formatters';
import { TranslationProvider } from '../../i18n/provider';
import { createTestI18n } from '../../i18n/testing';
import type { PetMap, PetWindowStatus } from '../../types/pets';
import { catalogue, NOW, status } from './fixtures';
import { labelMaps, mapContext } from './maps';
import {
  ago,
  collectionNotice,
  collectionSync,
  indexCatalogue,
  metres,
  nearbyRows,
  collectionStates,
  soulsLeftLabel,
  stageLabel,
  stateFrom,
} from './model';
import { SessionSummary } from './parts';
import { PetRadar } from './PetRadar';
import { PetsPanel, type PetsPanelProps } from './PetsPanel';

/* Brazilian Portuguese wording of the pets surfaces, with the real engine and catalogues. */

// Each engine created here becomes react-i18next's global one; the English setup engine is
// restored after every test so nothing rendered without a provider turns Portuguese.
const english = getI18n();
afterEach(() => {
  cleanup();
  setI18n(english);
});

const pt = createTestI18n('pt-BR').getFixedT('pt-BR', 'pets');
const fmt = formattersFor('pt-BR');

describe('pets model in Portuguese', () => {
  it('words souls left with Portuguese plurals and levels', () => {
    const thresholds = { 0: 5, 1: 25, 2: 50 };
    // 0 and 1 share the singular in Portuguese.
    expect(soulsLeftLabel(stateFrom(thresholds, 0, 5, null), pt)).toBe('0 alma para obter');
    expect(soulsLeftLabel(stateFrom(thresholds, 0, 4, null), pt)).toBe('1 alma para obter');
    expect(soulsLeftLabel(stateFrom(thresholds, 0, 3, null), pt)).toBe('2 almas para obter');
    expect(soulsLeftLabel(stateFrom(thresholds, 1, 24, null, true), pt)).toBe('~1 alma até o Nv 2');
    expect(stageLabel(stateFrom(thresholds, 3, 0, null), pt)).toBe('Nível máximo');
    expect(stageLabel(stateFrom(thresholds, 2, 0, null), pt)).toBe('Nível 2');
  });

  it('formats distances and ages for Brazil', () => {
    expect(metres(1500, fmt)).toBe('1,5 km');
    expect(metres(42.4, fmt)).toBe('42 m');
    expect(metres(12_345, fmt)).toBe('12 km');
    expect(ago(3_000, pt)).toBe('agora mesmo');
    expect(ago(3 * 60_000, pt)).toBe('há 3 min');
  });

  it('translates map words but keeps catalogue and faction names verbatim', () => {
    const map = (id: string, name: string): PetMap => ({
      id,
      name,
      zone_ids: [],
      bounds: [0, 0, 1, 1],
      art: null,
    });
    const labels = labelMaps(
      [
        map('World/World_L/World_L_A', 'Sunfield'),
        map('Dungeon/Party/Test_Den/Test_Den_Easy', 'Test Den'),
        map('Dungeon/Party/Test_Den/Test_Den_G_09', 'Test Den'),
      ],
      pt,
    );
    expect(labels.get('Dungeon/Party/Test_Den/Test_Den_Easy')?.label).toBe('Test Den · Fácil');
    expect(labels.get('Dungeon/Party/Test_Den/Test_Den_G_09')?.label).toBe(
      'Test Den · Variante G09',
    );
    const field = labels.get('World/World_L/World_L_A')!;
    expect(field).toMatchObject({ label: 'Sunfield', group: 'Regiões Elyos' });
    expect(mapContext(field, pt)).toBe('Elyos · Região');
  });

  it('keeps the character name verbatim inside a translated notice', () => {
    const sync = collectionSync(status({ live_synced: false }), true);
    const notice = collectionNotice(sync, NOW, pt)!;
    expect(notice.text).toMatch(/^O jogo não enviou a coleção completa de Tester nesta sessão/);
    expect(notice.text).toContain('há 1 min');
    expect(notice.text).toContain('volte à seleção de personagem');
  });

  it('words a monster native could not name in the interface language', () => {
    const index = indexCatalogue(catalogue(), pt);
    const live = status({
      nearby: [
        {
          entity_id: 1,
          npc_id: 999,
          name: '',
          pet_ids: [1],
          x: null,
          y: null,
          distance: 10,
          bearing: 0,
          observed_ms: NOW,
        },
      ],
    });
    const states = collectionStates(index.catalogue, live);
    expect(nearbyRows(index, states, live, true)[0]?.sighting.name).toBe('Monstro nº 999');
  });
});

describe('pets components in Portuguese', () => {
  it('formats session counts with Brazilian grouping and plurals', () => {
    const i18n = createTestI18n('pt-BR');
    const session = status().session!;
    render(
      <TranslationProvider i18n={i18n}>
        <SessionSummary
          status={status({
            session: { ...session, souls_gained: 1234, level_ups: 1, obtained: 0 },
          })}
        />
      </TranslationProvider>,
    );
    const summary = document.querySelector('.pet-session')!;
    expect(summary.textContent).toContain('1.234 almas');
    expect(summary.textContent).toContain('1 subida de nível');
    expect(summary.textContent).toContain('0 mascote novo');
    expect(summary.textContent).toContain('Esta sessão · 15 min');
  });

  it('words the in-game radar in Portuguese', () => {
    const i18n = createTestI18n('pt-BR');
    const index = indexCatalogue(catalogue(), i18n.getFixedT('pt-BR', 'pets'));
    render(
      <TranslationProvider i18n={i18n}>
        <PetRadar
          native
          index={index}
          status={status({ config: { ...status().config, pinned_ids: [1] } })}
          window={{
            requested: true,
            visible: true,
            ready: true,
            locked: true,
            game_active: true,
            errors: [],
          }}
          error=""
          busy={false}
          onPin={vi.fn<(pet: number, pinned: boolean) => void>()}
          onLock={vi.fn<(locked: boolean) => void>()}
          onHide={vi.fn<() => void>()}
        />
      </TranslationProvider>,
    );
    expect(screen.getByRole('region', { name: 'Radar de mascotes' })).toBeTruthy();
    expect(screen.getByText('Ao vivo')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Destravar o radar de mascotes para mover ou redimensionar',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Mascotes fixados' }).textContent).toContain('Ashwolf');
    expect(screen.getByRole('button', { name: 'Desafixar Ashwolf' })).toBeTruthy();
  });

  it('switches language in place without losing the open view', async () => {
    const i18n = createTestI18n('en');
    const index = indexCatalogue(catalogue(), i18n.getFixedT('en', 'pets'));
    const window: PetWindowStatus = {
      requested: false,
      visible: false,
      ready: true,
      locked: true,
      game_active: false,
      errors: [],
    };
    const ok = vi.fn<() => Promise<boolean>>(async () => true);
    const props: PetsPanelProps = {
      native: true,
      index,
      catalogueError: '',
      profileId: null,
      onProfile: vi.fn<(id: string | null) => void>(),
      pets: { status: status(), error: '', configure: ok, setPinned: ok },
      radar: {
        status: window,
        known: true,
        busy: false,
        error: '',
        toggle: ok,
        show: ok,
        lock: ok,
      },
      farming: { phase: 'idle', busy: false, notice: '', start: ok, stop: ok },
    };
    render(
      <TranslationProvider i18n={i18n}>
        <PetsPanel {...props} />
      </TranslationProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Collection' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search pets' }), {
      target: { value: 'Ash' },
    });
    await act(async () => {
      await i18n.changeLanguage('pt-BR');
    });
    expect(screen.getByRole('heading', { name: 'Mascotes' })).toBeTruthy();
    // The same tab is still open and the search kept its text.
    expect(screen.getByRole('tab', { name: 'Coleção' }).getAttribute('aria-selected')).toBe('true');
    expect(
      (screen.getByRole('searchbox', { name: 'Buscar mascotes' }) as HTMLInputElement).value,
    ).toBe('Ash');
    // Game names stay as the catalogue spells them.
    expect(screen.getAllByText('Ashwolf').length).toBeGreaterThan(0);
    expect(screen.getByText(/^1 de 4 mascotes$/)).toBeTruthy();
  });
});
