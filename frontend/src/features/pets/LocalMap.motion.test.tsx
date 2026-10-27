import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestI18n } from '../../i18n/testing';
import type { PetPosition } from '../../types/pets';
import { catalogue, NOW } from './fixtures';
import { LocalMap } from './LocalMap';
import { indexCatalogue } from './model';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shows fresh character facing and updates it without moving the position', () => {
  const index = indexCatalogue(catalogue(), createTestI18n('en').getFixedT('en', 'pets'));
  const map = index.maps.get('World/World_L/World_L_A')!;
  const player = { x: 100, y: 100, zone_id: 7, map_id: map.id, observed_ms: NOW };
  const element = (degrees: number, now = NOW, source: 'here' | 'last' = 'here') => {
    const props = { facing: { degrees, observed_ms: NOW } };
    return (
      <LocalMap
        {...props}
        index={index}
        view={{ map, player, source }}
        radius={250}
        rows={[]}
        pets={new Set()}
        goal={null}
        pinned={new Set()}
        now={now}
      />
    );
  };
  const view = render(element(0));
  const arrow = () => document.querySelector('[data-mark="player-facing"]');
  expect(arrow()).toBeTruthy();
  expect(arrow()?.getAttribute('transform')).toContain('rotate(0)');
  view.rerender(element(90));
  expect(arrow()?.getAttribute('transform')).toContain('rotate(90)');
  view.rerender(element(90, NOW + 10_001));
  expect(arrow()).toBeNull();
  view.rerender(element(90, NOW, 'last'));
  expect(arrow()).toBeTruthy();
  expect(document.querySelector('[data-mark="player-last"]')).toBeTruthy();
});

it('marks predicted radar movement and removes the estimate after a confirmed stop', () => {
  let time = 0;
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  const frame = (at: number) =>
    act(() => {
      time = at;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(at);
    });
  const index = indexCatalogue(catalogue(), createTestI18n('en').getFixedT('en', 'pets'));
  const map = index.maps.get('World/World_L/World_L_A')!;
  const position = (x: number, observed_ms: number): PetPosition => ({
    x,
    y: 100,
    zone_id: 7,
    map_id: map.id,
    observed_ms,
  });
  const element = (player: PetPosition) => (
    <LocalMap
      index={index}
      view={{ map, player, source: 'here' }}
      radius={250}
      rows={[]}
      pets={new Set([1])}
      goal={null}
      pinned={new Set()}
      now={player.observed_ms}
    />
  );
  const view = render(element(position(0, NOW)));
  expect(screen.queryByText('Estimated position')).toBeNull();
  time = 500;
  view.rerender(element(position(1000, NOW + 500)));
  frame(700);
  expect(screen.getByText('Estimated position')).toBeTruthy();
  expect(document.querySelector('[data-mark="player-estimate"]')).toBeTruthy();
  frame(1250);
  expect(frames.size).toBe(0);
  // A stationary measured fix cancels the projected velocity and reconciles the marker.
  time = 1500;
  view.rerender(element(position(1000, NOW + 1500)));
  frame(1700);
  expect(screen.queryByText('Estimated position')).toBeNull();
  expect(document.querySelector('[data-mark="player-estimate"]')).toBeNull();
});
