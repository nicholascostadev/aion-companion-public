import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationProvider } from '../../i18n/provider';
import { createTestI18n } from '../../i18n/testing';
import type { PetsStatus } from '../../types/pets';
import { catalogue, status } from './fixtures';
import { indexCatalogue } from './model';
import { PetsPanel, type PetsPanelProps } from './PetsPanel';

afterEach(cleanup);

const PLAINS = 'World/World_L/World_L_A';

function draw(live: PetsStatus = status()) {
  const i18n = createTestI18n('en');
  const index = indexCatalogue(catalogue(), i18n.getFixedT('en', 'pets'));
  const ok = () => vi.fn<() => Promise<boolean>>(async () => true);
  const props = {
    native: true,
    index,
    catalogueError: '',
    profileId: null,
    onProfile: vi.fn<(id: string | null) => void>(),
    pets: { status: live, error: '', configure: ok(), setPinned: ok() },
    radar: {
      status: {
        requested: false,
        visible: false,
        ready: true,
        locked: true,
        game_active: false,
        errors: [],
      },
      known: true,
      busy: false,
      error: '',
      toggle: ok(),
      show: ok(),
      lock: ok(),
    },
    farming: {
      phase: 'idle',
      busy: false,
      notice: '',
      start: ok(),
      stop: ok(),
    },
  } satisfies PetsPanelProps;
  render(
    <TranslationProvider i18n={i18n}>
      <PetsPanel {...props} />
    </TranslationProvider>,
  );
  return props;
}

/** The picker row's select button for a pet. */
const pickRow = (id: number) =>
  within(screen.getByRole('list', { name: 'Ranked pets' }))
    .getAllByRole('button')
    .find((b) => b.closest(`[data-pet-id="${id}"]`) && b.classList.contains('farm-pick-main'))!;
const detailName = () => document.getElementById('pet-detail-name')?.textContent ?? null;

describe('pet selection on the farming map', () => {
  it('clears the selection when the selected pet is chosen again', () => {
    draw();
    fireEvent.click(pickRow(1));
    expect(detailName()).toBe('Ashwolf');
    expect(pickRow(1).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(pickRow(1));
    expect(pickRow(1).getAttribute('aria-pressed')).toBe('false');
    expect(detailName()).toBeNull();
    expect(screen.getByText('Select a pet')).toBeTruthy();
  });

  it('clears the selection from the map without touching the goal or pins', () => {
    const props = draw(
      status({
        config: {
          ...status().config,
          pinned_ids: [1],
          farming_goal: { pet_id: 2, map_id: PLAINS },
        },
      }),
    );
    fireEvent.click(pickRow(1));
    expect(detailName()).toBe('Ashwolf');

    // The selected pet's own spawn mark lets it go again.
    const mark = screen
      .getAllByRole('button', { pressed: true })
      .find((el) => el.getAttribute('data-mark-key')?.startsWith('spawn:'))!;
    fireEvent.click(mark);
    expect(pickRow(1).getAttribute('aria-pressed')).toBe('false');
    // Nothing is selected, so the detail falls back to the farming goal.
    expect(detailName()).toBe('Barn Owl');

    fireEvent.click(pickRow(1));
    fireEvent.click(screen.getByRole('button', { name: 'Clear the selection' }));
    expect(detailName()).toBe('Barn Owl');
    expect(screen.queryByRole('button', { name: 'Clear the selection' })).toBeNull();

    // The goal and the pin are preferences; clearing a selection never saves anything.
    expect(screen.getByRole('region', { name: 'Farming goal' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Unpin Ashwolf' }).length).toBeGreaterThan(0);
    expect(props.pets.configure).not.toHaveBeenCalled();
    expect(props.pets.setPinned).not.toHaveBeenCalled();
    expect(props.farming.stop).not.toHaveBeenCalled();
  });
});
